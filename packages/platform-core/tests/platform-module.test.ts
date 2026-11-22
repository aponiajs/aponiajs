import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Module,
  createToken,
  provideFactory,
  type ValueProvider,
} from "@aponiajs/common";
import {
  ALL_PLATFORMS,
  createPlatformFactory,
  providePlatformModule,
  type PlatformModuleSupport,
} from "../src/index.ts";
import { fakeHost } from "./fixtures/fake-host.ts";

function supportOf(provider: ReturnType<typeof providePlatformModule>): PlatformModuleSupport {
  return (provider as ValueProvider<PlatformModuleSupport>).useValue;
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

describe("providePlatformModule", () => {
  test("defaults a declaration with no adapters to every shipped platform", () => {
    const support = supportOf(providePlatformModule({ key: "widgets" }));

    expect(support.platforms).toEqual([...ALL_PLATFORMS]);
    expect(support.adapters).toBeUndefined();
    expect(Object.isFrozen(support)).toBe(true);
    expect(Object.isFrozen(support.platforms)).toBe(true);
  });

  test("defaults the platforms to the adapter keys when only adapters are stated", () => {
    const support = supportOf(
      providePlatformModule({ key: "widgets", adapters: { hono: () => {}, h3: () => {} } }),
    );

    expect(support.platforms).toEqual(["hono", "h3"]);
  });

  test("refuses an empty key", () => {
    expect(() => providePlatformModule({ key: "  " })).toThrow(TypeError);
  });
});

describe("the platform declaration in a boot", () => {
  test("runs the selected adapter once, before the routes mount", async () => {
    const calls: string[] = [];

    @Module({
      providers: [
        providePlatformModule({
          key: "widgets",
          adapters: {
            fake: (application: { readonly name: string }) => {
              calls.push(`mount:${application.name}`);
            },
          },
        }),
      ],
    })
    class WidgetsModule {}

    @Controller("widgets")
    class WidgetsController {
      @Get("/")
      list(): string {
        calls.push("route");
        return "widgets";
      }
    }

    @Module({ imports: [WidgetsModule], controllers: [WidgetsController] })
    class AppModule {}

    const application = await createPlatformFactory(fakeHost()).create(AppModule, {
      logger: false,
    });
    const response = await application.handle(new Request("http://localhost/widgets"));

    expect(await response.text()).toBe("widgets");
    expect(calls).toEqual(["mount:AppModule", "route"]);
    await application.close();
  });

  test("resolves a token adapter from the module that declares it", async () => {
    const calls: string[] = [];
    const WIDGET_MOUNT = createToken<(application: unknown) => void>("widgets.mount");

    @Module({
      providers: [
        providePlatformModule({ key: "widgets", adapters: { fake: WIDGET_MOUNT } }),
        provideFactory(WIDGET_MOUNT, [], () => {
          calls.push("factory");
          return () => {
            calls.push("mount");
          };
        }),
      ],
    })
    class WidgetsModule {}

    @Module({ imports: [WidgetsModule] })
    class AppModule {}

    const application = await createPlatformFactory(fakeHost()).create(AppModule, {
      logger: false,
    });

    expect(calls).toEqual(["factory", "mount"]);
    await application.close();
  });

  test("refuses a platform the package does not declare, naming the package", async () => {
    @Module({
      providers: [providePlatformModule({ key: "widgets", platforms: ["elysia"] })],
    })
    class WidgetsModule {}

    @Module({ imports: [WidgetsModule] })
    class AppModule {}

    let thrown: unknown;
    try {
      await createPlatformFactory(fakeHost()).create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("UNSUPPORTED_PLATFORM_FEATURE");
    expect((thrown as AponiaError).details).toEqual({
      module: "widgets",
      platform: "fake",
      platforms: ["elysia"],
    });
  });

  test("mounts nothing for a supported platform the package states no adapter for", async () => {
    @Module({
      providers: [providePlatformModule({ key: "widgets", platforms: ["fake"] })],
    })
    class WidgetsModule {}

    @Module({ imports: [WidgetsModule] })
    class AppModule {}

    const application = await createPlatformFactory(fakeHost()).create(AppModule, {
      logger: false,
    });

    expect(application.getNativeApplication().routes).toEqual([]);
    await application.close();
  });

  test("fails the boot when the adapter throws", async () => {
    @Module({
      providers: [
        providePlatformModule({
          key: "widgets",
          adapters: {
            fake: () => {
              throw new Error("the platform mount refused");
            },
          },
        }),
      ],
    })
    class WidgetsModule {}

    @Module({ imports: [WidgetsModule] })
    class AppModule {}

    let thrown: unknown;
    try {
      await createPlatformFactory(fakeHost()).create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe("the platform mount refused");
  });
});
