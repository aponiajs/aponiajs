import {
  AponiaError,
  getConstructorDependencies,
  getControllerMetadata,
  getModuleMetadata,
  getRouteMetadata,
  getRouteParameterMetadata,
  isStandardSchema,
  type ClassToken,
  type Constructor,
  type ControllerDefinition,
  type DynamicModule,
  type ModuleClass,
  type ModuleDefinition,
  type ModuleImport,
  type ModuleMetadata,
  type ModuleProvider,
  type Provider,
  type RouteContext,
  type RouteParameterMetadata,
  type RouteSchema,
  type RouteValidator,
} from "@aponiajs/common";
import { Elysia, type AnySchema, type InputSchema, type TSchema } from "elysia";
import { ELYSIA_CONTROLLER, type RuntimeElysiaController } from "./controller.ts";

export type AponiaRootModule = ModuleImport;

export function compileRootModule(rootModule: AponiaRootModule): ModuleDefinition {
  if (isModuleDefinition(rootModule)) {
    return rootModule;
  }

  const compiledClasses = new Map<ModuleClass, ModuleDefinition>();
  const compiledDynamicModules = new Map<DynamicModule, ModuleDefinition>();
  const visiting: ModuleImport[] = [];

  const compile = (moduleImport: ModuleImport): ModuleDefinition => {
    if (typeof moduleImport === "function") {
      return compileClass(moduleImport);
    }
    if (isModuleDefinition(moduleImport)) {
      return moduleImport;
    }
    return compileDynamicModule(moduleImport);
  };

  const compileClass = (moduleClass: ModuleClass): ModuleDefinition => {
    const cached = compiledClasses.get(moduleClass);
    if (cached) {
      return cached;
    }

    assertNoModuleCycle(moduleClass, visiting);
    const metadata = getModuleMetadata(moduleClass);
    if (!metadata) {
      throw missingModuleDecorator(moduleClass);
    }

    visiting.push(moduleClass);
    try {
      const definition: ModuleDefinition = Object.freeze({
        id: moduleClass.name,
        imports: Object.freeze((metadata.imports ?? []).map(compile)),
        controllers: Object.freeze((metadata.controllers ?? []).map(compileDecoratedController)),
        providers: Object.freeze((metadata.providers ?? []).map(compileProvider)),
        exports: Object.freeze([...(metadata.exports ?? [])]),
      });
      compiledClasses.set(moduleClass, definition);
      return definition;
    } finally {
      visiting.pop();
    }
  };

  const compileDynamicModule = (dynamicModule: DynamicModule): ModuleDefinition => {
    const cached = compiledDynamicModules.get(dynamicModule);
    if (cached) {
      return cached;
    }

    assertNoModuleCycle(dynamicModule, visiting);
    const metadata = getModuleMetadata(dynamicModule.module);
    if (!metadata) {
      throw missingModuleDecorator(dynamicModule.module);
    }

    const mergedMetadata = mergeModuleMetadata(metadata, dynamicModule);
    visiting.push(dynamicModule);
    try {
      const definition: ModuleDefinition = Object.freeze({
        id: dynamicModule.id,
        instanceId: dynamicModule.instanceId,
        imports: Object.freeze((mergedMetadata.imports ?? []).map(compile)),
        controllers: Object.freeze(
          (mergedMetadata.controllers ?? []).map(compileDecoratedController),
        ),
        providers: Object.freeze((mergedMetadata.providers ?? []).map(compileProvider)),
        exports: Object.freeze([...(mergedMetadata.exports ?? [])]),
      });
      compiledDynamicModules.set(dynamicModule, definition);
      return definition;
    } finally {
      visiting.pop();
    }
  };

  return compile(rootModule);
}

function isModuleDefinition(moduleImport: ModuleImport): moduleImport is ModuleDefinition {
  return (
    typeof moduleImport !== "function" &&
    "controllers" in moduleImport &&
    !("module" in moduleImport)
  );
}

function moduleImportName(moduleImport: ModuleImport): string {
  if (typeof moduleImport === "function") {
    return moduleImport.name;
  }
  return moduleImport.id;
}

function assertNoModuleCycle(moduleImport: ModuleImport, visiting: readonly ModuleImport[]): void {
  const cycleIndex = visiting.indexOf(moduleImport);
  if (cycleIndex < 0) {
    return;
  }

  const cycle = [...visiting.slice(cycleIndex), moduleImport].map(moduleImportName);
  throw new AponiaError("MODULE_CYCLE", `Module import cycle detected: ${cycle.join(" -> ")}.`, {
    cycle,
  });
}

function missingModuleDecorator(moduleClass: ModuleClass): AponiaError {
  return new AponiaError(
    "INVALID_MODULE",
    `Class "${moduleClass.name}" is missing the @Module() decorator.`,
    { module: moduleClass.name },
  );
}

function mergeModuleMetadata(
  metadata: Readonly<ModuleMetadata>,
  dynamicModule: DynamicModule,
): ModuleMetadata {
  return Object.freeze({
    imports: Object.freeze([...(metadata.imports ?? []), ...(dynamicModule.imports ?? [])]),
    controllers: Object.freeze([
      ...(metadata.controllers ?? []),
      ...(dynamicModule.controllers ?? []),
    ]),
    providers: Object.freeze([...(metadata.providers ?? []), ...(dynamicModule.providers ?? [])]),
    exports: Object.freeze([...(metadata.exports ?? []), ...(dynamicModule.exports ?? [])]),
  });
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

        const parameters = getRouteParameterMetadata(controller, route.propertyKey);
        plugin.route(
          route.method,
          joinPaths(metadata.path, route.path),
          (context) => handler.call(instance, ...bindParameters(parameters, context)),
          toRouteHook(route.schema),
        );
      }

      return plugin;
    },
  });

  return definition;
}

/**
 * Builds the handler arguments described by parameter decorators. A handler
 * without them receives the whole context, which keeps `@Ctx()` optional for
 * single-argument handlers.
 */
function bindParameters(
  parameters: readonly RouteParameterMetadata[],
  context: RouteContext,
): readonly unknown[] {
  if (parameters.length === 0) {
    return [context];
  }

  const size = Math.max(...parameters.map((parameter) => parameter.index)) + 1;
  const bound = Array.from({ length: size }, () => undefined as unknown);
  for (const parameter of parameters) {
    bound[parameter.index] = resolveParameter(parameter, context);
  }
  return bound;
}

function resolveParameter(parameter: RouteParameterMetadata, context: RouteContext): unknown {
  const source = parameterSource(parameter, context);
  if (parameter.property === undefined) {
    return source;
  }
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[parameter.property];
  return parameter.kind === "cookie" ? (value as { value?: unknown } | undefined)?.value : value;
}

function parameterSource(parameter: RouteParameterMetadata, context: RouteContext): unknown {
  const contextRecord = context as unknown as Record<string, unknown>;
  switch (parameter.kind) {
    case "context":
      return context;
    case "set":
      return context.set;
    case "request":
      return context.request;
    default:
      return contextRecord[parameter.kind];
  }
}

function toRouteHook(schema: RouteSchema | undefined): InputSchema<never> | undefined {
  if (!schema) {
    return undefined;
  }

  const hook: InputSchema<never> = {
    ...(schema.body ? { body: toElysiaSchema(schema.body) } : {}),
    ...(schema.query ? { query: toElysiaSchema(schema.query) } : {}),
    ...(schema.params ? { params: toElysiaSchema(schema.params) } : {}),
    ...(schema.headers ? { headers: toElysiaSchema(schema.headers) } : {}),
    ...(schema.response ? { response: toElysiaSchema(schema.response) } : {}),
  };

  return Object.keys(hook).length === 0 ? undefined : hook;
}

/**
 * Standard Schema validators pass through unchanged. Platform-native TypeBox
 * validators reach the platform through the neutral `NativeSchema` contract,
 * which cannot describe TypeBox's `Kind` symbol, so they are restored here.
 */
function toElysiaSchema(validator: RouteValidator): AnySchema {
  return isStandardSchema(validator) ? validator : (validator as unknown as TSchema);
}

function joinPaths(controllerPath: string, routePath: string): string {
  const segments = [controllerPath, routePath]
    .map((path) => path.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
