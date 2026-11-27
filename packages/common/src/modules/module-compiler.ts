import { AponiaError } from "../exceptions/aponia-error.ts";
import { forwardRef, isForwardRef, resolveForwardRef } from "./forward-ref.ts";
import {
  getConstructorDependencies,
  getControllerMetadata,
  getInjectableMetadata,
  getModuleMetadata,
  isGlobalModule,
} from "../decorators/decorators.ts";
import { normalizeProvider, provideClass } from "../providers/provider.ts";
import { type ClassToken, type Constructor, type Token } from "../interfaces/token.interface.ts";
import { type ControllerDefinition } from "../interfaces/controller.interface.ts";
import {
  type DynamicModule,
  type ModuleClass,
  type ModuleExport,
  type ModuleImport,
  type ModuleMetadata,
  type ModuleProvider,
} from "../interfaces/decorators.interface.ts";
import {
  type ModuleDefinition,
  type ModuleImportDescriptor,
} from "../interfaces/module.interface.ts";
import { type Provider } from "../interfaces/provider.interface.ts";
import type {
  AponiaRootModule,
  ResolvedModuleImports,
} from "../interfaces/module-compiler.interface.ts";
import { isModuleDefinition } from "./module-definition.ts";
import { resolveModuleImports } from "./module-import.resolver.ts";
import { isThenableModuleImport } from "./module-thenable.ts";

/** The kind a module lowered without a platform's own controller compiler states. */
export const HttpControllerKind = "aponia.http-controller";
// One identity per class object, so two classes that happen to share a name do
// not collide in the graph and minification cannot change what the graph keys.
const moduleIdentities = new WeakMap<ModuleClass, symbol>();

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
export interface RootCompilationOptions {
  /** Lowers one decorated controller into the descriptor this platform mounts. */
  readonly compileController?: (controller: ClassToken<unknown>) => ControllerDefinition;
  /** Refuses a compiled graph whose routes two declarations claim. */
  readonly assertRoutes?: (root: ModuleDefinition) => void;
  /**
   * The symbol key a cached descriptor is stored under on a root class.
   *
   * Defaults to `aponia.compiled.descriptors`. A platform whose controller
   * lowering differs states its own key, so one class booted on two platforms
   * in one process keeps one graph per platform.
   */
  readonly cacheKey?: string;
  /**
   * The import replacements an asynchronous resolver produced.
   *
   * @internal A boot supplies this after awaiting `resolveModuleImports`; an
   * application never states it.
   */
  readonly resolvedImports?: ResolvedModuleImports;
}

/** Lowers a root module into the frozen descriptor the graph compiles. */
export function compileRootModule(
  rootModule: AponiaRootModule,
  options: RootCompilationOptions = {},
): ModuleDefinition {
  const unwrapped = resolveForwardRef(rootModule);
  if (isThenableModuleImport(unwrapped)) {
    throw thenableRootFailure();
  }
  if ((typeof unwrapped === "function" || typeof unwrapped === "object") && unwrapped !== null) {
    const target = unwrapped as unknown as Record<PropertyKey, unknown>;
    // The default key is a literal so the framework-contract guard can audit
    // every key the runtime writes; a platform states its own through `cacheKey`.
    const cached =
      options.cacheKey === undefined
        ? target[Symbol.for("aponia.compiled.descriptors")]
        : target[Symbol.for(options.cacheKey)];
    if (cached !== undefined) {
      return cached as ModuleDefinition;
    }
  }
  const compiledRoot = isModuleDefinition(unwrapped)
    ? unwrapped
    : (compileModuleImports(unwrapped, options) as ModuleDefinition);
  options.assertRoutes?.(compiledRoot);
  return compiledRoot;
}

/**
 * Lowers a root module whose graph may hold asynchronous registrations.
 *
 * A module may declare `imports: [Something.forRoot()]` where `forRoot()` is
 * `async`, exactly as Nest's `ConfigModule.forRoot()` is. This awaits those
 * registrations first, then lowers the resolved graph through the same
 * synchronous compiler every other caller uses.
 *
 * @param rootModule - The root class, descriptor, or registration.
 * @param options - The same lowering options `compileRootModule` accepts.
 * @returns The frozen root descriptor the container builds from.
 * @throws An `AponiaError` with the graph or route code naming the invalid declaration.
 *
 * @example
 * ```ts
 * const root = await compileRootModuleAsync(AppModule);
 * ```
 */
export async function compileRootModuleAsync(
  rootModule: AponiaRootModule,
  options: RootCompilationOptions = {},
): Promise<ModuleDefinition> {
  const resolvedImports = await resolveModuleImports(rootModule);
  return compileRootModule(resolvedImports.rootModule, { ...options, resolvedImports });
}

function thenableRootFailure(): AponiaError {
  return new AponiaError(
    "INVALID_MODULE",
    "A module import is a Promise. Boot the application, which awaits it, or call compileRootModuleAsync instead of compileRootModule.",
    { module: "Promise" },
  );
}

function compileModuleImports(
  rootModule: ModuleImport,
  options: RootCompilationOptions,
): ModuleDefinition {
  const compiledClasses = new Map<ModuleClass, ModuleDefinition>();
  const compiledDynamicModules = new Map<DynamicModule, ModuleDefinition>();
  // Only a class or a dynamic module is ever pushed while lowering, so the
  // stack is not a ModuleImport list: that union includes an asynchronous
  // registration, which this synchronous pass rejects before it is visited.
  const visiting: Array<ModuleClass | DynamicModule> = [];

  const compile = (moduleImport: ModuleImport): ModuleImportDescriptor => {
    if (isThenableModuleImport(moduleImport)) {
      throw thenableRootFailure();
    }
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
      const declaredImports =
        options.resolvedImports?.classImports.get(moduleClass) ?? metadata.imports ?? [];
      const imports = Object.freeze(declaredImports.map(compile));
      const directImports = imports.filter(
        (entry): entry is ModuleDefinition => !isForwardRef(entry),
      );
      const definition: ModuleDefinition = Object.freeze({
        id: moduleClass.name,
        moduleIdentity: moduleIdentity(moduleClass),
        moduleClass,
        ...(isGlobal ? { global: true } : {}),
        imports,
        controllers: Object.freeze((metadata.controllers ?? []).map(compileController(options))),
        providers: Object.freeze((metadata.providers ?? []).map(compileProvider)),
        exports: Object.freeze(expandExports(metadata.exports ?? [], directImports)),
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
    // A registration may carry an undecorated class: its collections are the
    // definition, so empty metadata is the ordinary shape for that path.
    const metadata = getModuleMetadata(dynamicModule.module) ?? Object.freeze({});

    const mergedMetadata = mergeModuleMetadata(metadata, dynamicModule);
    visiting.push(dynamicModule);
    try {
      const isGlobal = isGlobalModule(dynamicModule.module) || (mergedMetadata.global ?? false);
      const declaredImports =
        options.resolvedImports?.dynamicImports.get(dynamicModule) ?? mergedMetadata.imports ?? [];
      const imports = Object.freeze(declaredImports.map(compile));
      const directImports = imports.filter(
        (entry): entry is ModuleDefinition => !isForwardRef(entry),
      );
      const definition: ModuleDefinition = Object.freeze({
        id: dynamicModule.id,
        instanceId: dynamicModule.instanceId,
        moduleClass: dynamicModule.module,
        ...(isGlobal ? { global: true } : {}),
        imports,
        controllers: Object.freeze(
          (mergedMetadata.controllers ?? []).map(compileController(options)),
        ),
        providers: Object.freeze((mergedMetadata.providers ?? []).map(compileProvider)),
        exports: Object.freeze(expandExports(mergedMetadata.exports ?? [], directImports)),
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
export { isModuleDefinition } from "./module-definition.ts";

function moduleIdentity(moduleClass: ModuleClass): symbol {
  const existing = moduleIdentities.get(moduleClass);
  if (existing !== undefined) {
    return existing;
  }
  const identity = Symbol(moduleClass.name);
  moduleIdentities.set(moduleClass, identity);
  return identity;
}

function moduleImportName(moduleImport: ModuleImport): string {
  if (isThenableModuleImport(moduleImport)) {
    return "Promise";
  }
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
  const global = dynamicModule.global ?? metadata.global;
  return Object.freeze({
    ...(global === undefined ? {} : { global }),
    imports: Object.freeze([...(metadata.imports ?? []), ...(dynamicModule.imports ?? [])]),
    controllers: Object.freeze([
      ...(metadata.controllers ?? []),
      ...(dynamicModule.controllers ?? []),
    ]),
    providers: Object.freeze([...(metadata.providers ?? []), ...(dynamicModule.providers ?? [])]),
    exports: Object.freeze([...(metadata.exports ?? []), ...(dynamicModule.exports ?? [])]),
  });
}

/**
 * Expands an `exports` list: a token stays, an imported module contributes its
 * own resolved exports.
 *
 * A class is a token unless it is one of this module's compiled imports, where
 * it names a module to re-export. An object that names a module but was not
 * imported is refused rather than silently skipped, because an importer would
 * otherwise resolve nothing.
 */
function expandExports(
  entries: readonly ModuleExport[],
  imports: readonly ModuleDefinition[],
): Token<unknown>[] {
  const expanded: Token<unknown>[] = [];
  for (const entry of entries) {
    const imported = importedModuleOf(entry, imports);
    if (imported !== undefined) {
      expanded.push(...imported.exports);
      continue;
    }
    if (looksLikeModule(entry)) {
      throw new AponiaError("INVALID_EXPORT", "A module can only re-export a module it imports.", {
        module: moduleExportName(entry),
      });
    }
    expanded.push(entry as Token<unknown>);
  }
  return expanded;
}

function importedModuleOf(
  entry: ModuleExport,
  imports: readonly ModuleDefinition[],
): ModuleDefinition | undefined {
  for (const imported of imports) {
    if (imported.moduleClass === entry) {
      return imported;
    }
    if (typeof entry === "object" && entry !== null) {
      const candidate = entry as { readonly id?: unknown; readonly instanceId?: unknown };
      if (candidate.instanceId === imported.instanceId && candidate.id === imported.id) {
        return imported;
      }
    }
  }
  return undefined;
}

function looksLikeModule(entry: ModuleExport): boolean {
  if (typeof entry === "function") {
    return getModuleMetadata(entry) !== undefined;
  }
  return (
    typeof entry === "object" &&
    entry !== null &&
    ("module" in entry || ("providers" in entry && "imports" in entry))
  );
}

function moduleExportName(entry: ModuleExport): string {
  if (typeof entry === "function") {
    return entry.name;
  }
  const candidate = entry as {
    readonly id?: unknown;
    readonly module?: { readonly name?: unknown };
  };
  if (typeof candidate.id === "string") {
    return candidate.id;
  }
  return typeof candidate.module?.name === "string" ? candidate.module.name : "module";
}

function compileProvider(provider: ModuleProvider): Provider {
  if (typeof provider !== "function") {
    if ("kind" in provider) {
      return provider;
    }
    if ("useClass" in provider && provider.inject === undefined) {
      const useClass = provider.useClass as ClassToken<unknown>;
      const inject = getConstructorDependencies(useClass);
      return provideClass(
        provider.provide,
        useClass as unknown as Constructor<unknown, readonly unknown[]>,
        inject,
        provider.scope === undefined ? undefined : { scope: provider.scope },
      ) as Provider;
    }
    return normalizeProvider(provider);
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
  const durable = getInjectableMetadata(provider)?.durable;

  return Object.freeze({
    kind: "class",
    provide: provider,
    inject,
    useClass: provider as Constructor<unknown, never[]>,
    ...(scope === undefined ? {} : { scope }),
    ...(durable === undefined ? {} : { durable }),
  });
}

function compileController(
  options: RootCompilationOptions,
): (controller: ClassToken<unknown>) => ControllerDefinition {
  return options.compileController ?? compileNeutralController;
}

function compileNeutralController(controller: ClassToken<unknown>): ControllerDefinition {
  const metadata = getControllerMetadata(controller);
  if (!metadata) {
    throw new AponiaError(
      "INVALID_CONTROLLER",
      `Class "${controller.name}" is missing the @Controller() decorator.`,
      { controller: controller.name },
    );
  }

  const scope = getInjectableMetadata(controller)?.scope;
  const durable = getInjectableMetadata(controller)?.durable;
  return Object.freeze({
    kind: HttpControllerKind,
    token: controller,
    inject: getConstructorDependencies(controller),
    useClass: controller as Constructor<unknown, never[]>,
    ...(scope === undefined ? {} : { scope }),
    ...(durable === undefined ? {} : { durable }),
  });
}
