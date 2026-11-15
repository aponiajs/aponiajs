import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type OnApplicationBootstrap,
} from "@aponiajs/common";
import { createPlatformFactory } from "../src/index.ts";
import type { HostDispatcher, PlatformHost } from "../src/host/platform-host.types.ts";

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

interface FakeApp {
  readonly name: string;
  dispatch?: HostDispatcher;
}

function fakeHost(): PlatformHost<FakeApp> {
  return {
    name: "fake",
    createApplication(name) {
      return { name };
    },
    mount(application, dispatch) {
      application.dispatch = dispatch;
    },
    async fetch(application, request) {
      return (
        (await application.dispatch?.(request, {})) ?? new Response("host 404", { status: 404 })
      );
    },
    async close() {},
  };
}

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
});
