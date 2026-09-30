import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "../src/index.ts";

const calls: string[] = [];

class GlobalGuard {
  canActivate(): boolean {
    calls.push("global");
    return true;
  }
}

@Controller()
class AppController {
  @Get()
  read(): string {
    return "read";
  }
}

@Module({ controllers: [AppController], providers: [GlobalGuard] })
class AppModule {}

/**
 * The hook object Elysia mounts for the controller's only route, which is what a
 * boot compiles for that route made observable.
 */
function mountedHooks(application: AponiaElysiaApplication): Record<string, unknown> {
  const route = application
    .getNativeApplication()
    .routes.find((candidate) => candidate.path === "/") as { readonly hooks?: unknown } | undefined;
  if (route === undefined) {
    throw new Error("The application mounted no route at /.");
  }

  return (route.hooks ?? {}) as Record<string, unknown>;
}

describe("global enhancers", () => {
  test("the global enhancers appear in the hook array of a controller that declares none", async () => {
    calls.length = 0;
    const withGlobals = await AponiaFactory.create(AppModule, {
      logger: false,
      guards: [GlobalGuard],
    });
    const globalHooks = mountedHooks(withGlobals);
    const globalResponse = await withGlobals.handle(new Request("http://localhost/"));
    const globalCalls = [...calls];

    // The plain boot runs after the global one, so its half also shows the option
    // leaves nothing behind for the next application that boots.
    calls.length = 0;
    const withoutGlobals = await AponiaFactory.create(AppModule, { logger: false });
    const plainHooks = mountedHooks(withoutGlobals);
    const plainResponse = await withoutGlobals.handle(new Request("http://localhost/"));
    const plainCalls = [...calls];

    expect([globalResponse.status, await globalResponse.text()]).toEqual([200, "read"]);
    expect([plainResponse.status, await plainResponse.text()]).toEqual([200, "read"]);
    // A global enhancer is the application's declaration, not the route's: the
    // two scopes merge while a route mounts, so the guard reaches a controller
    // that declares none even though the compiled route it mounts from states its
    // own declarations and nothing else. Elysia 2 keeps a route's hook in the
    // shape it was declared in, and the platform declares the guards and the
    // interceptor before halves as one merged function, so the mounted guard
    // reads back as that function rather than as a list holding it.
    expect(typeof globalHooks.beforeHandle).toBe("function");
    expect(globalCalls).toEqual(["global"]);
    // A plain boot carries no enhancer hook at all.
    expect(plainHooks.beforeHandle).toBeUndefined();
    expect(plainCalls).toEqual([]);

    await withGlobals.close();
    await withoutGlobals.close();
  });
});
