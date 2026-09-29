import { expect, test } from "bun:test";
import { Injectable, defineModule, provideClass, type CanActivate } from "@aponiajs/common";
import {
  AponiaFactory,
  defineElysiaController,
  defineElysiaControllerRoutes,
  elysiaController,
} from "../src/index.ts";

class CallbackController {
  boom(): string {
    throw new Error("callback boom");
  }
}

/**
 * The concise direct-registration facade. Its callback is handed the real root
 * application and registers its own route, so the platform never compiled that
 * route and has nothing to attach a hook to.
 */
const callbackController = elysiaController(CallbackController, (application) =>
  application.get("/callback-boom", () => {
    throw new Error("callback boom");
  }),
);

const callbackModule = defineModule({
  id: "CallbackMountModule",
  controllers: [callbackController],
});

const guardCalls: string[] = [];

@Injectable()
class OwnGuard implements CanActivate {
  canActivate(): boolean {
    guardCalls.push("own");
    return true;
  }
}

class PluginController {
  read(): string {
    return "read";
  }
}

const pluginPlan = defineElysiaControllerRoutes(PluginController, {
  path: "plugin",
  routes: [
    {
      method: "GET",
      path: "guarded",
      propertyKey: "read",
      guards: [OwnGuard],
    },
  ],
});

/**
 * A low-level definition that owns an isolated plugin: bootstrap mounts it with
 * `use()`, and the plugin was built outside a boot, so it resolved no enhancer.
 */
const pluginOnlyController = defineElysiaController(PluginController, {
  inject: [] as const,
  buildPlugin: (controller) => pluginPlan.buildPlugin(controller),
});

const pluginModule = defineModule({
  id: "PluginMountModule",
  providers: [provideClass(OwnGuard, [])],
  controllers: [pluginOnlyController],
});

class BootstrapController {
  read(): string {
    return "read";
  }
}

/** The same plan shape, mounted by bootstrap from its compiled plan. */
const bootstrapPlan = defineElysiaControllerRoutes(BootstrapController, {
  path: "bootstrap",
  routes: [
    {
      method: "GET",
      path: "guarded",
      propertyKey: "read",
      guards: [OwnGuard],
    },
  ],
});

const bootstrapModule = defineModule({
  id: "BootstrapMountModule",
  providers: [provideClass(OwnGuard, [])],
  controllers: [bootstrapPlan],
});

test("a registerRoutes callback's route answers Elysia's own 500, message included", async () => {
  const application = await AponiaFactory.create(callbackModule, { logger: false });

  const response = await application.handle(new Request("http://localhost/callback-boom"));

  // Nothing the platform compiles reaches a route a callback registered: no
  // guard, no interceptor, no declared filter, and no default Problem Details
  // mapping. What the handler throws therefore surfaces through Elysia's own
  // unknown-error path — a Problem Details 500 that repeats the exception's message
  // to the client, which is exactly what the mapping exists to prevent.
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(await response.json()).toMatchObject({ status: 500, detail: "callback boom" });
  await application.close();
});

test("a plan's own guard does not run when the plan is mounted through its buildPlugin", async () => {
  guardCalls.length = 0;
  const application = await AponiaFactory.create(pluginModule, { logger: false });

  const response = await application.handle(new Request("http://localhost/plugin/guarded"));

  // The plan declares the guard, and the route still answers unguarded: a plugin
  // built outside a boot resolved nothing, so `unmountedRouteEnhancers` is what
  // it mounted with. The control below mounts the same plan shape so a case that
  // only ever saw this application could not pass on a broken guard fixture.
  expect([response.status, await response.text(), guardCalls]).toEqual([200, "read", []]);
  await application.close();

  const control = await AponiaFactory.create(bootstrapModule, { logger: false });
  const controlled = await control.handle(new Request("http://localhost/bootstrap/guarded"));

  expect([controlled.status, await controlled.text(), guardCalls]).toEqual([200, "read", ["own"]]);
  await control.close();
});
