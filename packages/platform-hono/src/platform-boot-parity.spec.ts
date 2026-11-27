import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  HttpStatus,
  Injectable,
  Module,
  provideValue,
  type AponiaMiddleware,
  type CanActivate,
  type OnApplicationShutdown,
  type OnModuleInit,
  type ExceptionFilter,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import { type GatewayServerOptions, type ResolvedMiddlewareConfig } from "@aponiajs/common";
import { RequestContextModule, RequestContextService } from "@aponiajs/core";
import { createBootstrapFactory } from "./application/bootstrap.ts";
import { fakeHost } from "../test/fixtures/fake-host.ts";

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Injectable()
class CatchAll implements ExceptionFilter {
  catch(error: unknown): Response {
    return new Response(String(error), { status: 599 });
  }
}

@Injectable()
class Started implements OnModuleInit {
  static started = 0;

  onModuleInit(): void {
    Started.started += 1;
  }
}

@Injectable()
class FailingShutdown implements OnApplicationShutdown {
  onApplicationShutdown(): void {
    throw new Error("shutdown failed");
  }
}

@Injectable()
class TraceMiddleware implements AponiaMiddleware {
  use(_context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    return next();
  }
}

@Controller("plain")
class PlainController {
  @Get()
  run(): string {
    return "ok";
  }

  @Get("boom")
  boom(): never {
    throw new Error("boom");
  }

  @Get("status")
  status(@HttpStatus() status: (code: string, body?: unknown) => Response): Response {
    return status("Accepted", { ok: true });
  }
}

@Module({
  controllers: [PlainController],
  providers: [DenyGuard, CatchAll, TraceMiddleware, Started],
})
class PlainModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes("/plain");
  }
}

describe("platform boot options", () => {
  test("applies option-level guards and filters", async () => {
    const guarded = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: false,
      guards: [DenyGuard],
    });
    expect((await guarded.handle(new Request("http://localhost/plain"))).status).toBe(403);
    await guarded.close();

    const filtered = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: false,
      filters: [CatchAll],
    });
    const response = await filtered.handle(new Request("http://localhost/plain/boom"));
    expect(response.status).toBe(599);
    await filtered.close();
  });

  test("mounts module middleware and publishes it to the host", async () => {
    const base = fakeHost();
    let configs: readonly ResolvedMiddlewareConfig[] | undefined;
    const host = {
      ...base,
      mountMiddleware(_application: unknown, mounted: readonly ResolvedMiddlewareConfig[]): void {
        configs = mounted;
      },
    };
    const application = await createBootstrapFactory(host as never).create(PlainModule, {
      logger: false,
    });
    expect(configs?.length).toBe(1);
    expect(configs?.[0]?.middleware[0]).toBeInstanceOf(TraceMiddleware);
    await application.close();
  });

  test("establishes the request context and echoes its header", async () => {
    @Controller("context")
    class ContextController {
      constructor(private readonly context: RequestContextService) {}

      @Get()
      run(): { readonly requestId: string | undefined } {
        return { requestId: this.context.current()?.requestId };
      }
    }

    @Module({
      imports: [RequestContextModule.forRoot({ header: "x-parity-id" })],
      controllers: [ContextController],
    })
    class ContextModule {}

    const application = await createBootstrapFactory(fakeHost()).create(ContextModule, {
      logger: false,
    });
    const response = await application.handle(
      new Request("http://localhost/context", { headers: { "x-parity-id": "abc-123" } }),
    );

    expect(await response.json()).toEqual({ requestId: "abc-123" });
    expect(response.headers.get("x-parity-id")).toBe("abc-123");
    await application.close();
  });

  test("accepts logger levels and closes once", async () => {
    const application = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: ["error"],
    });
    await application.close();
    await application.close();
    expect(application.getNativeApplication().name).toBe("PlainModule");
  });

  test("refuses a listener on a host that states none", async () => {
    const application = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: false,
    });
    expect(application.listen(0)).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM_FEATURE",
    });
    expect(() => application.getUrl()).toThrow();
    await application.close();
  });

  test("merges the server-wide gateway options it is given", async () => {
    const base = fakeHost();
    let options: GatewayServerOptions | undefined;
    const host = {
      ...base,
      configureGatewayOptions(_application: unknown, merged: GatewayServerOptions): void {
        options = merged;
      },
    };
    const application = await createBootstrapFactory(host as never).create(PlainModule, {
      logger: false,
    });
    expect(options).toBeDefined();
    await application.close();
  });

  test("resolves a Reflector the root can inject", async () => {
    const { Reflector } = await import("@aponiajs/common");
    const application = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: false,
    });
    expect(application.get(Reflector)).toBeInstanceOf(Reflector);
    await application.close();
  });

  test("resolves an option guard stated as an instance", async () => {
    const application = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: false,
      guards: [new DenyGuard()] as never,
    });
    expect((await application.handle(new Request("http://localhost/plain"))).status).toBe(403);
    await application.close();
  });

  test("refuses handle on a host that answers no raw requests", async () => {
    const host = { ...fakeHost(), fetch: undefined };
    const application = await createBootstrapFactory(host as never).create(PlainModule, {
      logger: false,
    });
    expect(() => application.handle(new Request("http://localhost/plain"))).toThrow();
    await application.close();
  });

  test("reports a shutdown failure and survives a refusing logger", async () => {
    @Module({ controllers: [PlainController], providers: [FailingShutdown] })
    class FailingModule {}
    const logger = {
      log() {},
      error() {
        throw new Error("logger refused");
      },
      warn() {},
      debug() {},
      verbose() {},
      fatal() {},
    };
    const application = await createBootstrapFactory(fakeHost()).create(FailingModule, {
      logger: logger as never,
    });
    await application.close();
    expect(Started.started).toBeGreaterThan(0);
  });

  test("answers through the shared route handler's status helper", async () => {
    const application = await createBootstrapFactory(fakeHost()).create(PlainModule, {
      logger: false,
    });
    const response = await application.handle(new Request("http://localhost/plain/status"));
    expect(response.status).toBe(202);
    await application.close();
  });

  test("merges two gateways' server options by the strictest value", async () => {
    const { WebSocketGateway } = await import("@aponiajs/common");
    @WebSocketGateway({
      path: "/one",
      maxPayloadLength: 2048,
      idleTimeoutMs: 3000,
      sendPings: true,
    })
    @Injectable()
    class OneGateway {}
    @WebSocketGateway({ path: "/two", maxPayloadLength: 1024, idleTimeoutMs: 1500 })
    @Injectable()
    class TwoGateway {}
    @Module({ providers: [OneGateway, TwoGateway] })
    class GatewayModule {}

    let options: GatewayServerOptions | undefined;
    const host = {
      ...fakeHost(),
      mountGateway() {},
      configureGatewayOptions(_application: unknown, merged: GatewayServerOptions): void {
        options = merged;
      },
    };
    const application = await createBootstrapFactory(host as never).create(GatewayModule, {
      logger: false,
    });
    expect(options).toEqual({
      maxPayloadLength: 1024,
      idleTimeoutSeconds: 2,
      sendPings: true,
    });
    await application.close();
  });

  test("keeps an explicit provider value for a route", async () => {
    const token = (await import("@aponiajs/common")).createToken<string>("VALUE");
    @Module({
      controllers: [PlainController],
      providers: [provideValue(token, "provided")],
      exports: [token],
    })
    class ModuleWithValue {}
    const application = await createBootstrapFactory(fakeHost()).create(ModuleWithValue, {
      logger: false,
    });
    expect(application.get(token)).toBe("provided");
    await application.close();
  });
});
