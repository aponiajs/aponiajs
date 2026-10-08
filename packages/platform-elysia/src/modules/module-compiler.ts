import {
  AponiaError,
  forwardRef,
  getConstructorDependencies,
  getControllerMetadata,
  getInjectableMetadata,
  getModuleMetadata,
  isForwardRef,
  isGlobalModule,
  resolveForwardRef,
  type ClassToken,
  type Constructor,
  type ControllerDefinition,
  type DynamicModule,
  type ModuleClass,
  type ModuleDefinition,
  type ModuleImport,
  type ModuleImportDescriptor,
  type ModuleMetadata,
  type ModuleProvider,
  type Provider,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import { CONTROLLER_KIND } from "../controllers/controller.constants.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import { unmountedRouteEnhancers } from "../controllers/enhancer-resolver.ts";
import {
  compileElysiaRoutes,
  joinPaths,
  registerCompiledElysiaRoutes,
} from "../routing/route-compiler.ts";
import type { AponiaRootModule } from "./module-compiler.types.ts";
import { assertUniqueElysiaRoutes } from "./route-uniqueness.ts";

/**
 * Lowers a root module into the frozen descriptor the graph compiles.
 *
 * A descriptor root passes through (after the duplicate-route check); a
 * decorated class or dynamic module is lowered from its metadata. Both
 * authoring paths stay supported.
 *
 * @param rootModule - The root class, descriptor, or descriptor artifact selection.
 * @returns The frozen root descriptor the container builds from.
 * @throws An `AponiaError` with the graph or route code naming the invalid declaration.
 *
 * @example
 * ```ts
 * const root = compileRootModule(AppModule);
 * ```
 */
export function compileRootModule(rootModule: AponiaRootModule): ModuleDefinition {
  const unwrapped = resolveForwardRef(rootModule);
  if (
    (typeof unwrapped === "function" || typeof unwrapped === "object") &&
    unwrapped !== null &&
    (unwrapped as unknown as Record<PropertyKey, unknown>)[
      Symbol.for("aponia.compiled.descriptors")
    ] !== undefined
  ) {
    return (unwrapped as unknown as Record<PropertyKey, unknown>)[
      Symbol.for("aponia.compiled.descriptors")
    ] as ModuleDefinition;
  }
  const compiledRoot = isModuleDefinition(unwrapped)
    ? unwrapped
    : (compileModuleImports(unwrapped) as ModuleDefinition);
  assertUniqueElysiaRoutes(compiledRoot);
  return compiledRoot;
}

function compileModuleImports(rootModule: ModuleImport): ModuleDefinition {
  const compiledClasses = new Map<ModuleClass, ModuleDefinition>();
  const compiledDynamicModules = new Map<DynamicModule, ModuleDefinition>();
  const visiting: ModuleImport[] = [];

  const compile = (moduleImport: ModuleImport): ModuleImportDescriptor => {
    if (isForwardRef(moduleImport)) {
      return forwardRef(() => {
        const unwrapped = moduleImport.forwardRef();
        return compile(unwrapped) as ModuleDefinition;
      });
    }
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
      const isGlobal = isGlobalModule(moduleClass) || (metadata.global ?? false);
      const definition: ModuleDefinition = Object.freeze({
        id: moduleClass.name,
        moduleClass,
        ...(isGlobal ? { global: true } : {}),
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
      const isGlobal = isGlobalModule(dynamicModule.module) || (mergedMetadata.global ?? false);
      const definition: ModuleDefinition = Object.freeze({
        id: dynamicModule.id,
        instanceId: dynamicModule.instanceId,
        moduleClass: dynamicModule.module,
        ...(isGlobal ? { global: true } : {}),
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

  return resolveForwardRef(compile(rootModule));
}

/**
 * Whether a module import is already the descriptor the container compiles,
 * rather than a class or a dynamic module the boot lowers.
 *
 * Exported because a boot's own record has to name the graph it served, and the
 * answer is this one question: a descriptor is data, while a class and a dynamic
 * module both have their decorators read and lowered here.
 *
 * @internal
 */
export function isModuleDefinition(moduleImport: unknown): moduleImport is ModuleDefinition {
  return (
    typeof moduleImport === "object" &&
    moduleImport !== null &&
    !isForwardRef(moduleImport) &&
    "controllers" in moduleImport &&
    !("module" in moduleImport)
  );
}

function moduleImportName(moduleImport: ModuleImport): string {
  if (isForwardRef(moduleImport)) {
    return moduleImportName(moduleImport.forwardRef());
  }
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

  // A class registered on its own is lowered from the metadata a decorator made
  // TypeScript emit, so a class nothing decorates resolves to no dependencies
  // however many parameters its constructor takes. The container would then
  // construct it with the rest `undefined`, and nothing downstream notices: the
  // instance exists, its methods run, and the failure surfaces at the first use of
  // a value nobody filled. Registering the class through `provideClass(provider,
  // [])` is how an application says the empty list is a decision rather than the
  // accident, and that path is not checked here.
  //
  // The count is the constructor's own `length`, which TypeScript leaves as the
  // parameter count with `?` erased — so a class with an optional parameter and no
  // decorator lands here too, and the fix named in the message is the same one.
  if (inject.length < provider.length) {
    throw new AponiaError(
      "UNRESOLVED_CONSTRUCTOR_DEPENDENCIES",
      `Provider "${provider.name}" is registered without dependencies and its constructor takes ${provider.length}: a class carries no dependency metadata until something decorates it, so add @Injectable() to the class or @Inject() to each parameter — or register it with provideClass(${provider.name}, []) when nothing has to arrive.`,
      { provider: provider.name, required: provider.length, supplied: inject.length },
    );
  }

  const scope = getInjectableMetadata(provider)?.scope;

  return Object.freeze({
    kind: "class",
    provide: provider,
    inject,
    useClass: provider as Constructor<unknown, never[]>,
    ...(scope === undefined ? {} : { scope }),
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

  const routes = compileElysiaRoutes(controller, metadata.path);
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
