import {
  AponiaError,
  getConstructorDependencies,
  getControllerMetadata,
  getModuleMetadata,
  getRouteMetadata,
  type ClassToken,
  type Constructor,
  type ControllerDefinition,
  type ModuleClass,
  type ModuleDefinition,
  type ModuleProvider,
  type Provider,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import { ELYSIA_CONTROLLER, type RuntimeElysiaController } from "./controller.ts";

export type AponiaRootModule = ModuleClass | ModuleDefinition;

export function compileRootModule(rootModule: AponiaRootModule): ModuleDefinition {
  if (typeof rootModule !== "function") {
    return rootModule;
  }

  const compiled = new Map<ModuleClass, ModuleDefinition>();
  const visiting: ModuleClass[] = [];

  const compile = (moduleClass: ModuleClass): ModuleDefinition => {
    const cached = compiled.get(moduleClass);
    if (cached) {
      return cached;
    }

    const cycleIndex = visiting.indexOf(moduleClass);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), moduleClass].map((item) => item.name);
      throw new AponiaError(
        "MODULE_CYCLE",
        `Module import cycle detected: ${cycle.join(" -> ")}.`,
        { cycle },
      );
    }

    const metadata = getModuleMetadata(moduleClass);
    if (!metadata) {
      throw new AponiaError(
        "INVALID_MODULE",
        `Class "${moduleClass.name}" is missing the @Module() decorator.`,
        { module: moduleClass.name },
      );
    }

    visiting.push(moduleClass);
    try {
      const definition: ModuleDefinition = Object.freeze({
        id: moduleClass.name,
        imports: Object.freeze(
          (metadata.imports ?? []).map((moduleImport) =>
            typeof moduleImport === "function" ? compile(moduleImport) : moduleImport,
          ),
        ),
        controllers: Object.freeze((metadata.controllers ?? []).map(compileDecoratedController)),
        providers: Object.freeze((metadata.providers ?? []).map(compileProvider)),
        exports: Object.freeze([...(metadata.exports ?? [])]),
      });
      compiled.set(moduleClass, definition);
      return definition;
    } finally {
      visiting.pop();
    }
  };

  return compile(rootModule);
}

function compileProvider(provider: ModuleProvider): Provider {
  if (typeof provider !== "function") {
    return provider;
  }

  const inject = getConstructorDependencies(provider);
  return Object.freeze({
    kind: "class",
    provide: provider,
    inject,
    useClass: provider as Constructor<unknown, never[]>,
  });
}

function compileDecoratedController(controller: ClassToken<unknown>): ControllerDefinition {
  const metadata = getControllerMetadata(controller);
  if (!metadata) {
    throw new AponiaError(
      "INVALID_CONTROLLER",
      `Class "${controller.name}" is missing the @Controller() decorator.`,
      { controller: controller.name },
    );
  }

  const routes = getRouteMetadata(controller);
  const definition: RuntimeElysiaController = Object.freeze({
    kind: ELYSIA_CONTROLLER,
    token: controller,
    path: joinPaths(metadata.path, ""),
    inject: getConstructorDependencies(controller),
    useClass: controller as Constructor<unknown, never[]>,
    buildPlugin: (instance: unknown) => {
      const plugin = new Elysia();

      for (const route of routes) {
        const handler = (instance as Record<PropertyKey, unknown>)[route.propertyKey];
        if (typeof handler !== "function") {
          throw new AponiaError(
            "INVALID_CONTROLLER",
            `Route handler "${String(route.propertyKey)}" is not callable.`,
            { controller: controller.name, handler: String(route.propertyKey) },
          );
        }

        plugin.route(route.method, joinPaths(metadata.path, route.path), () =>
          Reflect.apply(handler, instance, []),
        );
      }

      return plugin;
    },
  });

  return definition;
}

function joinPaths(controllerPath: string, routePath: string): string {
  const segments = [controllerPath, routePath]
    .map((path) => path.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
