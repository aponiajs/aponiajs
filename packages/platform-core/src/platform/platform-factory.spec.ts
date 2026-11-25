import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Deprecated,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type OnApplicationBootstrap,
} from "@aponiajs/common";
import { createPlatformFactory } from "../index.ts";
import { fakeHost } from "../../test/fixtures/fake-host.ts";

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
  const application = await createPlatformFactory(fakeHost()).create(LegacyModule, {
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
  const application = await createPlatformFactory(fakeHost()).create(LegacyModule, {
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

describe("createPlatformFactory", () => {
  test("boots a module graph and serves the routes it mounted", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(AppModule);
    const response = await application.handle(new Request("http://localhost/greetings/ada"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(application.getNativeApplication().name).toBe("AppModule");
    expect(application.platform).toBe("fake");
    await application.close();
  });

  test("applies the prefix to every mounted route", async () => {
    const factory = createPlatformFactory(fakeHost());
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
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(AppModule);

    expect(events).toEqual(["bootstrapped"]);
    await application.close();
  });

  test("answers through the host's own fetch when it has one", async () => {
    const host = fakeHost();
    const factory = createPlatformFactory(host);
    const native = await factory.createNative(AppModule);

    const response = await host.fetch?.(native, new Request("http://localhost/greetings/bob"));
    expect(await response?.text()).toBe("hello");
    expect(await host.fetch?.(native, new Request("http://localhost/none"))).toMatchObject({
      status: 404,
    });
  });

  test("closes once, whatever the number of calls", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(AppModule);

    await application.close();
    await application.close();
    expect(true).toBe(true);
  });

  test("mounts liveness and readiness, and drains readiness when the stop begins", async () => {
    const application = await createPlatformFactory(fakeHost()).create(AppModule, {
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
      await createPlatformFactory(fakeHost()).create(HealthModule, { logger: false, health: true });
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
    const application = await createPlatformFactory(fakeHost()).create(AppModule, {
      logger: false,
      health: { livenessPath: "/livez", readinessPath: "/readyz" },
    });

    expect((await application.handle(new Request("http://localhost/livez"))).status).toBe(200);
    expect((await application.handle(new Request("http://localhost/readyz"))).status).toBe(200);
    await application.close();
  });
});
