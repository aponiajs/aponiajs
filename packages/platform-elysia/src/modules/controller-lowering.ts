import {
  AponiaError,
  getConstructorDependencies,
  getControllerMetadata,
  getInjectableMetadata,
  type ClassToken,
  type Constructor,
  type ControllerDefinition,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import { unmountedRouteEnhancers } from "../controllers/enhancer-resolver.ts";
import { CONTROLLER_KIND } from "../controllers/controller.constants.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import {
  compileElysiaRoutes,
  joinPaths,
  registerCompiledElysiaRoutes,
} from "../routing/route-compiler.ts";

/**
 * Lowers one decorated controller into the descriptor this platform mounts.
 *
 * The module compiler calls this for every controller a module declares. The
 * route plan is compiled here, and the definition's own `buildPlugin` mounts it
 * through the same callback a boot uses, with the enhancer resolution a plugin
 * built outside a boot has: none.
 *
 * @internal
 */
export function compileDecoratedController(controller: ClassToken<unknown>): ControllerDefinition {
  const metadata = getControllerMetadata(controller);
  if (!metadata) {
    throw new AponiaError(
      "INVALID_CONTROLLER",
      `Class "${controller.name}" is missing the @Controller() decorator.`,
      { controller: controller.name },
    );
  }

  const routes = compileElysiaRoutes(controller, metadata.path);
  const scope = getInjectableMetadata(controller)?.scope;
  const registerRoutes = (plugin: Elysia, instance: unknown): void => {
    // Bootstrap mounts this controller's plan itself, where the enhancer
    // resolution exists; this callback is what the definition's own
    // `buildPlugin` mounts through, and a plugin built outside a boot resolves
    // nothing.
    registerCompiledElysiaRoutes(plugin, controller, instance, routes, unmountedRouteEnhancers);
  };
  const definition: RuntimeElysiaController = Object.freeze({
    kind: CONTROLLER_KIND,
    token: controller,
    path: joinPaths(metadata.path, ""),
    inject: getConstructorDependencies(controller),
    useClass: controller as Constructor<unknown, never[]>,
    ...(scope === undefined ? {} : { scope }),
    compiledRoutes: routes,
    buildPlugin: (instance: unknown) => {
      const plugin = new Elysia();
      registerRoutes(plugin, instance);
      return plugin;
    },
    registerRoutes,
  });

  return definition;
}
