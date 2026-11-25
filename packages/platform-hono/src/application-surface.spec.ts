import { expect, test } from "bun:test";
import {
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  type CanActivate,
  type ExceptionFilter,
  type Interceptor,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory, type HonoAponiaApplication } from "./index.ts";

/**
 * The Nest surface `AponiaHttpApplication` carries on Hono after a boot, which
 * is the same surface the Elysia platform returns. A boot mounts its routes
 * during `AponiaFactory.create`, so these methods record their configuration and
 * `init()` re-runs the boot once; these cases assert the merged configuration
 * reaches the routes and that a misuse is refused rather than silently ignored.
 */

const calls: string[] = [];

@Injectable()
class RecordingGuard implements CanActivate {
  canActivate(): boolean {
    calls.push("guard");
    return true;
  }
}

@Injectable()
class RecordingInterceptor implements Interceptor {
  interceptBefore(): void {
    calls.push("before");
  }

  interceptAfter(): void {
    calls.push("after");
  }
}

@Catch()
@Injectable()
class RecordingFilter implements ExceptionFilter {
  catch(): Response {
    calls.push("filter");
    return new Response("filtered", { status: 418 });
  }
}

@Injectable()
class RecordingPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return `piped:${String(value)}`;
  }
}

@Controller("probe")
class ProbeController {
  @Get()
  read(): string {
    calls.push("handler");
    return "probe";
  }

  @Get("boom")
  boom(): never {
    throw new Error("boom");
  }
}

@Module({
  controllers: [ProbeController],
  providers: [RecordingGuard, RecordingInterceptor, RecordingFilter, RecordingPipe],
})
class SurfaceModule {}

async function boot(): Promise<HonoAponiaApplication> {
  return await AponiaFactory.create(SurfaceModule, { logger: false });
}

const stopSignals = ["SIGTERM", "SIGINT"] as const;

function captureProcessListeners(): { SIGTERM: readonly Function[]; SIGINT: readonly Function[] } {
  return {
    SIGTERM: process.listeners("SIGTERM"),
    SIGINT: process.listeners("SIGINT"),
  };
}

function restoreProcessListeners(captured: ReturnType<typeof captureProcessListeners>): void {
  for (const signal of stopSignals) {
    const before = captured[signal];
    for (const listener of process.listeners(signal)) {
      if (!before.includes(listener)) {
        process.off(signal, listener as () => void);
      }
    }
  }
}

test("the global surface methods are applied by init and reach the mounted routes", async () => {
  calls.length = 0;
  const application = await boot();

  try {
    application
      .useGlobalGuards(RecordingGuard)
      .useGlobalInterceptors(RecordingInterceptor)
      .useGlobalPipes(RecordingPipe)
      .useGlobalFilters(RecordingFilter)
      .enableCors()
      .useSecurityHeaders()
      .setGlobalPrefix("/api")
      .enableVersioning({ type: "header", header: "x-api-version" })
      .useLogger({
        log: () => {},
        fatal: () => {},
        error: () => {},
        warn: () => {},
      })
      .flushLogs();
    application.enableShutdownHooks();

    const initialized = await application.init();
    expect(initialized).toBe(application);

    // A second init applies nothing twice.
    expect(await application.init()).toBe(application);

    const response = await application.handle(new Request("http://localhost/api/probe"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("probe");
    expect(calls).toEqual(["guard", "before", "handler", "after"]);

    const failed = await application.handle(new Request("http://localhost/api/probe/boom"));
    expect(failed.status).toBe(418);
    expect(await failed.text()).toBe("filtered");
    expect(calls.filter((call) => call === "filter")).toHaveLength(1);
  } finally {
    await application.close();
  }
});

test("useSecurityHeaders refuses a second declaration", async () => {
  const application = await boot();
  try {
    application.useSecurityHeaders();
    expect(() => application.useSecurityHeaders()).toThrow(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  } finally {
    await application.close();
  }
});

test("a boot with no surface configuration is not re-run by init", async () => {
  const application = await boot();
  try {
    const native = application.getNativeApplication();
    expect(await application.init()).toBe(application);
    expect(application.getNativeApplication()).toBe(native);
    expect((await application.handle(new Request("http://localhost/probe"))).status).toBe(200);
  } finally {
    await application.close();
  }
});

test("a surface method refuses to change routes the application already applied", async () => {
  const application = await boot();
  try {
    application.setGlobalPrefix("/api");
    await application.init();
    expect(() => application.setGlobalPrefix("/other")).toThrow(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  } finally {
    await application.close();
  }
});

test("getHttpServer states the bound Bun server, and nothing before listen", async () => {
  const application = await boot();
  try {
    expect(application.getHttpServer()).toBeUndefined();
    await application.listen(0);
    expect(application.getHttpServer()).toBeDefined();
  } finally {
    await application.close();
  }
});

test("enableShutdownHooks installs one set of stop-signal listeners at listen", async () => {
  const captured = captureProcessListeners();
  const application = await boot();
  try {
    application.enableShutdownHooks();
    await application.listen(0);

    expect(process.listeners("SIGTERM")).toHaveLength(captured.SIGTERM.length + 1);
    expect(process.listeners("SIGINT")).toHaveLength(captured.SIGINT.length + 1);

    // A second call keeps the one set: a second would run the teardown twice.
    application.enableShutdownHooks();
    expect(process.listeners("SIGTERM")).toHaveLength(captured.SIGTERM.length + 1);
  } finally {
    await application.close();
    restoreProcessListeners(captured);
  }
});
