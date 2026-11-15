import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import {
  AponiaFactory,
  type AponiaAdapter,
  type HostDispatcher,
  type KernelAdapter,
} from "../src/index.ts";

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
  dispatch?: HostDispatcher<never>;
}

function kernelAdapter(): KernelAdapter<FakeApp, never> {
  return {
    kind: "host",
    name: "fake",
    createApplication: (name) => ({ name }),
    mount(application, dispatch) {
      application.dispatch = dispatch;
    },
  };
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
});
