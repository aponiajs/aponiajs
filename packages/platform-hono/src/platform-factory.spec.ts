import { describe, expect, test } from "bun:test";
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  AponiaError,
  Catch,
  Controller,
  Deprecated,
  Get,
  Injectable,
  Module,
  SubscribeMessage,
  UseGuards,
  Version,
  VersioningType,
  WebSocketGateway,
  type CanActivate,
  type ExceptionFilter,
  type Interceptor,
  type LoggerService,
  type OnApplicationBootstrap,
} from "@aponiajs/common";
import { AponiaHttpApplication, createBootstrapFactory } from "./application/bootstrap.ts";
import { fakeHost } from "../test/fixtures/fake-host.ts";

@Injectable()
class AllowGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

const events: string[] = [];

@Injectable()
class Startup implements OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    events.push("bootstrapped");
  }
}

@Controller("greetings")
class GreetingController {
  @Get(":name")
  @UseGuards(AllowGuard)
  greet(): string {
    return "hello";
  }
}

@Module({ controllers: [GreetingController], providers: [AllowGuard, Startup] })
class AppModule {}

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Controller("legacy")
class LegacyController {
  @Get("/")
  @Deprecated({ sunset: "2031-01-01T00:00:00Z", link: "https://example.test/v2" })
  read(): string {
    return "legacy";
  }

  @Get("/guarded")
  @UseGuards(DenyGuard)
  @Deprecated()
  guarded(): string {
    return "never";
  }
}

@Module({ controllers: [LegacyController], providers: [DenyGuard] })
class LegacyModule {}

test("answers a deprecated route with its policy headers", async () => {
  const application = await createBootstrapFactory(fakeHost()).create(LegacyModule, {
    logger: false,
  });

  try {
    const response = await application.handle(new Request("http://localhost/legacy"));

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("sunset")).toBe(new Date("2031-01-01T00:00:00Z").toUTCString());
    expect(response.headers.get("link")).toBe('<https://example.test/v2>; rel="deprecation"');
  } finally {
    await application.close();
  }
});

test("a guard refusal carries the deprecation policy", async () => {
  const application = await createBootstrapFactory(fakeHost()).create(LegacyModule, {
    logger: false,
  });

  try {
    const response = await application.handle(new Request("http://localhost/legacy/guarded"));

    expect(response.status).toBe(403);
    expect(response.headers.get("deprecation")).toBe("true");
  } finally {
    await application.close();
  }
});

describe("createBootstrapFactory", () => {
  test("boots a module graph and serves the routes it mounted", async () => {
    const factory = createBootstrapFactory(fakeHost());
    const application = await factory.create(AppModule);
    const response = await application.handle(new Request("http://localhost/greetings/ada"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(application.getNativeApplication().name).toBe("AppModule");
    expect(application.platform).toBe("fake");
    await application.close();
  });

  test("applies the prefix to every mounted route", async () => {
    const factory = createBootstrapFactory(fakeHost());
    const application = await factory.create(AppModule, { prefix: "/api" });

    expect(
      (await application.handle(new Request("http://localhost/api/greetings/ada"))).status,
    ).toBe(200);
    expect((await application.handle(new Request("http://localhost/greetings/ada"))).status).toBe(
      404,
    );
    await application.close();
  });

  test("runs the bootstrap lifecycle hook once", async () => {
    events.length = 0;
    const factory = createBootstrapFactory(fakeHost());
    const application = await factory.create(AppModule);

    expect(events).toEqual(["bootstrapped"]);
    await application.close();
  });

  test("answers through the host's own fetch when it has one", async () => {
    const host = fakeHost();
    const factory = createBootstrapFactory(host);
    const native = await factory.createNative(AppModule);

    const response = await host.fetch?.(native, new Request("http://localhost/greetings/bob"));
    expect(await response?.text()).toBe("hello");
    expect(await host.fetch?.(native, new Request("http://localhost/none"))).toMatchObject({
      status: 404,
    });
  });

  test("closes once, whatever the number of calls", async () => {
    const factory = createBootstrapFactory(fakeHost());
    const application = await factory.create(AppModule);

    await application.close();
    await application.close();
    expect(true).toBe(true);
  });

  test("mounts liveness and readiness, and drains readiness when the stop begins", async () => {
    const application = await createBootstrapFactory(fakeHost()).create(AppModule, {
      logger: false,
      health: true,
    });

    const live = await application.handle(new Request("http://localhost/health/live"));
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toBe("application/health+json");
    expect(await live.json()).toEqual({ status: "pass" });

    const ready = await application.handle(new Request("http://localhost/health/ready"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "pass" });

    await application.close();

    const drained = await application.handle(new Request("http://localhost/health/ready"));
    expect(drained.status).toBe(503);
    expect(await drained.json()).toEqual({ status: "fail" });
    // Liveness keeps answering: a process that should be restarted is one that
    // stops answering at all.
    const stillLive = await application.handle(new Request("http://localhost/health/live"));
    expect(stillLive.status).toBe(200);
  });

  test("refuses a probe path a controller already claims", async () => {
    @Controller("health")
    class HealthController {
      @Get("live")
      live(): string {
        return "mine";
      }
    }

    @Module({ controllers: [HealthController] })
    class HealthModule {}

    let thrown: unknown;
    try {
      await createBootstrapFactory(fakeHost()).create(HealthModule, {
        logger: false,
        health: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as AponiaError).code).toBe("DUPLICATE_ROUTE");
    expect((thrown as AponiaError).details).toMatchObject({
      method: "GET",
      path: "/health/live",
      controller: "HealthController",
    });
  });

  test("honours the paths the health option states", async () => {
    const application = await createBootstrapFactory(fakeHost()).create(AppModule, {
      logger: false,
      health: { livenessPath: "/livez", readinessPath: "/readyz" },
    });

    expect((await application.handle(new Request("http://localhost/livez"))).status).toBe(200);
    expect((await application.handle(new Request("http://localhost/readyz"))).status).toBe(200);
    await application.close();
  });
});

describe("bootstrap surface and edge cases", () => {
  test("tryHandle handles matched routes, CORS preflight, version rejections, and returns undefined for 404", async () => {
    @Controller("items")
    class ItemsController {
      @Get("/")
      @Version("1")
      list(): string {
        return "v1";
      }
    }

    @Module({ controllers: [ItemsController] })
    class ItemsModule {}

    const application = await createBootstrapFactory(fakeHost()).create(ItemsModule, {
      logger: false,
      cors: true,
      versioning: { type: VersioningType.HEADER, header: "x-api-version" },
    });

    try {
      const preflight = await application.tryHandle(
        new Request("http://localhost/items", {
          method: "OPTIONS",
          headers: { origin: "https://example.test", "access-control-request-method": "GET" },
        }),
      );
      expect(preflight?.status).toBe(204);

      const matched = await application.tryHandle(
        new Request("http://localhost/items", { headers: { "x-api-version": "1" } }),
      );
      expect(matched?.status).toBe(200);

      const wrongVersion = await application.tryHandle(
        new Request("http://localhost/items", { headers: { "x-api-version": "2" } }),
      );
      expect(wrongVersion?.status).toBe(400);

      const unmatched = await application.tryHandle(
        new Request("http://localhost/missing", { headers: { "x-api-version": "1" } }),
      );
      expect(unmatched).toBeUndefined();
    } finally {
      await application.close();
    }
  });

  test("resolves APP_GUARD, APP_INTERCEPTOR, and APP_FILTER providers and exposes logger/adapter helpers", async () => {
    const trace: string[] = [];

    @Injectable()
    class GlobalGuard implements CanActivate {
      canActivate(): boolean {
        trace.push("guard");
        return true;
      }
    }

    @Injectable()
    class GlobalInterceptor implements Interceptor {
      interceptBefore(): void {
        trace.push("interceptor");
      }
    }

    @Catch()
    @Injectable()
    class GlobalFilter implements ExceptionFilter {
      catch(): Response {
        trace.push("filter");
        return new Response("filtered", { status: 418 });
      }
    }

    @Controller("edge")
    class EdgeController {
      @Get("fail")
      fail(): never {
        throw new Error("boom");
      }
    }

    @Module({
      controllers: [EdgeController],
      providers: [
        { provide: APP_GUARD, useClass: GlobalGuard },
        { provide: APP_INTERCEPTOR, useClass: GlobalInterceptor },
        { provide: APP_FILTER, useClass: GlobalFilter },
      ],
    })
    class EdgeModule {}

    const customLogger: LoggerService = {
      log: () => {},
      error: () => {},
      warn: () => {},
      fatal: () => {},
    };

    const host = {
      ...fakeHost(),
      listen: async () => ({
        url: "http://localhost:0",
        close: async () => {},
      }),
    };
    const application = await createBootstrapFactory(host).create(EdgeModule, {
      logger: false,
    });

    try {
      expect(application.getHttpAdapter()).toBe(application.getNativeApplication());
      expect(application.useLogger(customLogger)).toBe(application);
      application.flushLogs();

      const res = await application.handle(new Request("http://localhost/edge/fail"));
      expect(res.status).toBe(418);
      expect(trace).toEqual(["guard", "interceptor", "filter"]);

      await application.listen(0);
      expect(() => application.getHttpServer()).toThrow(
        expect.objectContaining({ code: "UNSUPPORTED_PLATFORM_FEATURE" }),
      );
    } finally {
      await application.close();
    }
  });

  test("refuses init() on an application without boot metadata and rejects unsupported host capabilities", async () => {
    const manual = new AponiaHttpApplication(
      fakeHost(),
      {
        native: { name: "fake", routes: [] },
        matchedRequests: new WeakSet(),
        root: undefined as never,
        routes: [],
        container: undefined as never,
        shutdown: async () => {},
        listener: {},
        readiness: { markShuttingDown: () => {} } as never,
      },
      undefined,
    );
    manual.useGlobalGuards();
    let initError: unknown;
    try {
      await manual.init();
    } catch (error) {
      initError = error;
    }
    expect((initError as AponiaError).code).toBe("INVALID_CONFIGURATION");

    @Controller("plain")
    class PlainController {
      @Get("/")
      index(): string {
        return "ok";
      }
    }
    @Module({ controllers: [PlainController] })
    class PlainModule {}

    let staticError: unknown;
    try {
      await createBootstrapFactory(fakeHost()).create(PlainModule, {
        logger: false,
        staticAssets: { root: "/tmp", prefix: "/assets" },
      });
    } catch (error) {
      staticError = error;
    }
    expect((staticError as AponiaError).code).toBe("UNSUPPORTED_PLATFORM_FEATURE");

    @WebSocketGateway("/ws")
    class FirstGateway {
      @SubscribeMessage("ping")
      ping(): string {
        return "pong";
      }
    }

    @Module({ providers: [FirstGateway] })
    class GatewayModule {}

    let wsUnsupportedError: unknown;
    try {
      await createBootstrapFactory(fakeHost()).create(GatewayModule, { logger: false });
    } catch (error) {
      wsUnsupportedError = error;
    }
    expect((wsUnsupportedError as AponiaError).code).toBe("UNSUPPORTED_PLATFORM_FEATURE");

    const hostWithWs = {
      ...fakeHost(),
      mountGateway: () => {},
    };

    @WebSocketGateway("/ws")
    class DuplicatePathGateway {}

    @Module({ providers: [FirstGateway, DuplicatePathGateway] })
    class DupPathModule {}

    let dupPathError: unknown;
    try {
      await createBootstrapFactory(hostWithWs).create(DupPathModule, { logger: false });
    } catch (error) {
      dupPathError = error;
    }
    expect((dupPathError as AponiaError).code).toBe("DUPLICATE_WEBSOCKET_GATEWAY");

    @WebSocketGateway("/ws-two")
    class DuplicateEventGateway {
      @SubscribeMessage("ping")
      pingAgain(): string {
        return "pong";
      }
    }

    @Module({ providers: [FirstGateway, DuplicateEventGateway] })
    class DupEventModule {}

    let dupEventError: unknown;
    try {
      await createBootstrapFactory(hostWithWs).create(DupEventModule, { logger: false });
    } catch (error) {
      dupEventError = error;
    }
    expect((dupEventError as AponiaError).code).toBe("DUPLICATE_WEBSOCKET_HANDLER");
  });
});
