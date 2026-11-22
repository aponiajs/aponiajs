import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaAdapter, type KernelAdapter } from "../src/index.ts";
import { fakeHost } from "./fixtures/fake-host.ts";

@Controller("greetings")
class GreetingController {
  @Get()
  index(): { readonly ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [GreetingController] })
class AppModule {}

interface FakeApp {
  readonly name: string;
}

function kernelAdapter(): KernelAdapter<FakeApp, never> {
  return { ...fakeHost(), kind: "host" };
}

describe("the unified factory", () => {
  test("boots through a kernel host and returns the shared application surface", async () => {
    const application = await AponiaFactory.create(AppModule, {
      adapter: kernelAdapter(),
      logger: false,
    });

    expect((application.getHttpAdapter() as FakeApp).name).toBe("AppModule");
    expect((await application.handle(new Request("http://localhost/greetings"))).status).toBe(200);
    expect(application).toBeInstanceOf(Object);
    await application.close();
  });

  test("resolves an adapter whose runtime boots through its own factory", async () => {
    const calls: string[] = [];
    const adapter: AponiaAdapter<undefined> = {
      kind: "application",
      name: "custom",
      async create() {
        calls.push("delegated");
        return {
          handle: () => new Response("ok"),
          listen: async (port: number) => {
            void port;
            throw new Error("not used");
          },
          getUrl: () => "http://localhost",
          get: () => undefined as never,
          getHttpAdapter: () => undefined,
          close: async () => {},
        };
      },
    };

    const application = await AponiaFactory.create(AppModule, { adapter });
    expect(calls).toEqual(["delegated"]);
    expect(await (await application.handle(new Request("http://localhost/"))).text()).toBe("ok");
  });

  test("refuses a listen on a host that states none", async () => {
    const application = await AponiaFactory.create(AppModule, {
      adapter: kernelAdapter(),
      logger: false,
    });

    try {
      await application.listen(0);
      throw new Error("Expected the listen to be refused.");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("UNSUPPORTED_PLATFORM_FEATURE");
    }
    await application.close();
  });

  test("reads no address before listen", async () => {
    const application = await AponiaFactory.create(AppModule, {
      adapter: kernelAdapter(),
      logger: false,
    });

    expect(() => application.getUrl()).toThrow();
    await application.close();
  });

  test("takes the adapter positionally, the way NestFactory.create does", async () => {
    const application = await AponiaFactory.create(AppModule, kernelAdapter(), {
      prefix: "/api",
      logger: false,
    });
    const response = await application.handle(new Request("http://localhost/api/greetings"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await application.close();
  });

  test("takes an application adapter positionally as well", async () => {
    const calls: string[] = [];
    const adapter: AponiaAdapter<undefined> = {
      kind: "application",
      name: "custom",
      async create() {
        calls.push("delegated");
        return {
          handle: () => new Response("ok"),
          listen: async (port: number) => {
            void port;
            throw new Error("not used");
          },
          getUrl: () => "http://localhost",
          get: () => undefined as never,
          getHttpAdapter: () => undefined,
          close: async () => {},
        };
      },
    };

    const application = await AponiaFactory.create(AppModule, adapter, { logger: false });

    expect(calls).toEqual(["delegated"]);
    expect(await (await application.handle(new Request("http://localhost/"))).text()).toBe("ok");
  });
});
