import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Module, type LoggerService } from "@aponiajs/common";
import { Elysia } from "elysia";
import { AponiaApplication, AponiaFactory } from "../src/index.ts";

class RecordingLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}
  error(): void {}
  warn(): void {}
}

@Controller("bootstrap-probe")
class BootstrapProbeController {
  @Get()
  read(): string {
    return "probe";
  }
}

@Module({ controllers: [BootstrapProbeController] })
class BootstrapProbeModule {}

let sharedControllerInstances = 0;

@Controller("shared-bootstrap")
class SharedBootstrapController {
  constructor() {
    sharedControllerInstances += 1;
  }

  @Get()
  read(): { readonly instances: number } {
    return { instances: sharedControllerInstances };
  }
}

@Module({ controllers: [SharedBootstrapController] })
class SharedBootstrapModule {}

@Module({ imports: [SharedBootstrapModule] })
class SharedBootstrapFeatureModule {}

@Module({ imports: [SharedBootstrapModule, SharedBootstrapFeatureModule] })
class SharedBootstrapRootModule {}

/**
 * Captures everything the default system logger writes to standard output while
 * `operation` runs, then restores the stream.
 */
async function captureStandardOutput<TResult>(
  operation: () => Promise<TResult>,
): Promise<{ readonly output: string; readonly result: TResult }> {
  const chunks: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk: string) => {
    chunks.push(chunk);
    return true;
  });

  try {
    const result = await operation();
    return { output: chunks.join(""), result };
  } finally {
    write.mockRestore();
  }
}

test("emits bootstrap output through the default system logger when no logger option is given", async () => {
  const { output, result: application } = await captureStandardOutput(() =>
    AponiaFactory.create(BootstrapProbeModule),
  );
  const response = await application.handle(new Request("http://localhost/bootstrap-probe"));

  expect(output).toContain("Starting Aponia application...");
  expect(output).toContain("[AponiaFactory]");
  expect(output).toContain("BootstrapProbeModule dependencies initialized");
  expect(output).toContain("BootstrapProbeController {/bootstrap-probe}:");
  expect(output).toContain("Mapped {/bootstrap-probe, GET} route");
  expect(await response.text()).toBe("probe");
  await application.close();
});

test("applies an array logger policy as explicit log levels", async () => {
  const silent = await captureStandardOutput(() =>
    AponiaFactory.create(BootstrapProbeModule, { logger: ["fatal"] }),
  );
  const silentResponse = await silent.result.handle(
    new Request("http://localhost/bootstrap-probe"),
  );

  expect(silent.output).toBe("");
  expect(await silentResponse.text()).toBe("probe");
  await silent.result.close();

  const logging = await captureStandardOutput(() =>
    AponiaFactory.create(BootstrapProbeModule, { logger: ["log"] }),
  );

  expect(logging.output).toContain("Starting Aponia application...");
  expect(logging.output).toContain("Mapped {/bootstrap-probe, GET} route");
  await logging.result.close();
});

test("logs and returns the resolved origin once the native application is listening", async () => {
  const logger = new RecordingLogger();
  const state: { server: { readonly url: URL } | undefined } = { server: undefined };
  const nativeApplication = {
    get server() {
      return state.server;
    },
    modules: Promise.resolve(),
    listen(port: number) {
      state.server = { url: new URL(`http://localhost:${port}`) };
    },
  } as unknown as Elysia;
  const application = new AponiaApplication(nativeApplication, logger);

  await application.listen(4_567);

  expect(application.getUrl()).toBe("http://localhost:4567");
  expect(logger.records).toEqual([
    {
      context: "AponiaApplication",
      message: "Aponia application successfully started",
    },
    {
      context: "AponiaApplication",
      message: "Application is running on: http://localhost:4567",
    },
  ]);
});

test("instantiates a controller once when its module is imported through two paths", async () => {
  sharedControllerInstances = 0;
  const application = await AponiaFactory.create(SharedBootstrapRootModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/shared-bootstrap"));

  expect(sharedControllerInstances).toBe(1);
  expect(await response.json()).toEqual({ instances: 1 });
  expect(
    application.getNativeApplication().routes.filter((route) => route.path === "/shared-bootstrap"),
  ).toHaveLength(1);
  await application.close();
});
