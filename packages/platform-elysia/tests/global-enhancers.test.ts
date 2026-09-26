import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "../src/index.ts";

class GlobalGuard {
  canActivate(): boolean {
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
function mountedHooks(application: AponiaElysiaApplication): unknown {
  const route = application
    .getNativeApplication()
    .routes.find((candidate) => candidate.path === "/") as { readonly hooks?: unknown } | undefined;
  if (route === undefined) {
    throw new Error("The application mounted no route at /.");
  }

  return route.hooks;
}

describe("global enhancers", () => {
  test("a global enhancer does not change the route a controller that declares none mounts", async () => {
    // The plain boot runs after the global one, so the comparison also shows the
    // option leaves nothing behind for the next application that boots.
    const withGlobals = await AponiaFactory.create(AppModule, {
      logger: false,
      guards: [GlobalGuard],
    });
    const globalHooks = mountedHooks(withGlobals);
    const globalResponse = await withGlobals.handle(new Request("http://localhost/"));

    const withoutGlobals = await AponiaFactory.create(AppModule, { logger: false });
    const plainHooks = mountedHooks(withoutGlobals);
    const plainResponse = await withoutGlobals.handle(new Request("http://localhost/"));

    expect([globalResponse.status, await globalResponse.text()]).toEqual([200, "read"]);
    expect([plainResponse.status, await plainResponse.text()]).toEqual([200, "read"]);
    // A global enhancer is the application's declaration, not the route's: the
    // two scopes merge while a route mounts, so the compiled route a controller
    // produces states its own declarations and nothing else.
    expect(globalHooks).toEqual(plainHooks);

    await withGlobals.close();
    await withoutGlobals.close();
  });
});
