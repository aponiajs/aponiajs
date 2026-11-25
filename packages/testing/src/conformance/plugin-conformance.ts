import type { DynamicModule, Token } from "@aponiajs/common";

/**
 * The registration surface every Aponia plugin module exposes.
 *
 * This is the runtime half of the plugin standard in
 * `docs/tooling/plugin-packages.md`: a module a package publishes registers
 * through `forRoot`, and — unless the synchronous registration decides which
 * providers exist — accepts `forRootAsync`.
 */
export interface PluginRegistrationSurface {
  /** The canonical registration; the module's `forRoot` method. */
  readonly forRoot?: unknown;
  /** The asynchronous registration, when the module has one. */
  readonly forRootAsync?: unknown;
  /** The deprecated beta alias; absent from a generated package. */
  readonly register?: unknown;
}

/** How a package states its registration obligations. */
export interface PluginConformanceOptions {
  /**
   * Whether `forRootAsync` is required. `false` is the documented exception for
   * a module whose synchronous registration decides which providers exist: a
   * `ConfigurationToken` module, an optionless module, or one that mounts
   * nothing when disabled.
   */
  readonly asynchronous?: boolean;
}

/**
 * Reports the registration members a plugin module is missing.
 *
 * Returns an empty frozen list for a compliant module. A package asserts the
 * result in its own lane; `scripts/plugin-standard.spec.ts` runs the same check
 * over every module the workspace publishes.
 *
 * @param moduleClass - The module class, read structurally so no import is imposed.
 * @param options - Whether the asynchronous registration is required.
 * @returns The missing member names, in contract order.
 *
 * @example
 * ```ts
 * expect(pluginRegistrationIssues(CacheModule)).toEqual([]);
 * ```
 */
export function pluginRegistrationIssues(
  moduleClass: PluginRegistrationSurface,
  options: PluginConformanceOptions = {},
): readonly string[] {
  const issues: string[] = [];
  if (typeof moduleClass.forRoot !== "function") {
    issues.push("forRoot");
  }
  if (options.asynchronous !== false && typeof moduleClass.forRootAsync !== "function") {
    issues.push("forRootAsync");
  }
  return Object.freeze(issues);
}

/**
 * Reports the structural rules a registration's dynamic module breaks.
 *
 * A module package hands the definition its `forRoot` or `forRootAsync` built
 * and the class it belongs to. The check is deliberately about the shape a
 * caller can observe without booting: the module identity is the class itself,
 * the definition and its collections are frozen, and the registration carries
 * an id and its own instance identity. A module that spreads another module's
 * registration into the definition changes the identity and fails here.
 *
 * Behavioral rules — the options token resolving, a Promise factory being
 * awaited, teardown running — belong to the package's own boot tests, which
 * exercise the public entrypoint.
 *
 * @param definition - The dynamic module the registration returned.
 * @param moduleClass - The module class the registration belongs to.
 * @returns The broken rule names, in contract order, frozen.
 *
 * @example
 * ```ts
 * expect(dynamicModuleIssues(CacheModule.forRoot(), CacheModule)).toEqual([]);
 * ```
 */
export function dynamicModuleIssues(
  definition: DynamicModule,
  moduleClass: object,
): readonly string[] {
  const issues: string[] = [];
  if (definition.module !== moduleClass) {
    issues.push("module");
  }
  if (!Object.isFrozen(definition)) {
    issues.push("definition");
  }
  if (typeof definition.id !== "string" || definition.id.length === 0) {
    issues.push("id");
  }
  if (definition.instanceId === undefined) {
    issues.push("instanceId");
  }
  for (const collection of ["imports", "controllers", "providers", "exports"] as const) {
    const value = definition[collection];
    if (value !== undefined && !Object.isFrozen(value)) {
      issues.push(collection);
    }
  }
  return Object.freeze(issues);
}

/**
 * Reports whether two registrations of one module stay independent.
 *
 * Two calls to `forRoot` must produce two definitions with distinct instance
 * identities, because the graph keys a module by `instanceId ?? id`. Sharing a
 * definition or an identity would make the second registration collide with the
 * first with `DUPLICATE_MODULE`.
 *
 * @param first - The first registration.
 * @param second - The second registration of the same module.
 * @param moduleClass - The module class both registrations belong to.
 * @returns The structural issues plus any shared identity, frozen.
 */
export function registrationIsolationIssues(
  first: DynamicModule,
  second: DynamicModule,
  moduleClass: object,
): readonly string[] {
  const issues = [
    ...dynamicModuleIssues(first, moduleClass),
    ...dynamicModuleIssues(second, moduleClass),
  ];
  if (first === second) {
    issues.push("shared definition");
  }
  if (first.instanceId === second.instanceId) {
    issues.push("shared instanceId");
  }
  return Object.freeze(issues);
}

/**
 * Reports whether a registration exposes its options under the declared token.
 *
 * A configurable module states its options through one token, and that token is
 * the only way a consumer reads what the registration received. The provider
 * must be in `providers` and in `exports`; a token provided but not exported is
 * invisible to every importer.
 *
 * @param definition - The dynamic module the registration returned.
 * @param token - The options token the module declares.
 * @returns The missing places, in contract order, frozen.
 */
export function optionsTokenIssues(
  definition: DynamicModule,
  token: Token<unknown>,
): readonly string[] {
  const issues: string[] = [];
  if (!(definition.providers ?? []).some((provider) => providerToken(provider) === token)) {
    issues.push("provider");
  }
  if (!(definition.exports ?? []).includes(token)) {
    issues.push("export");
  }
  return Object.freeze(issues);
}

/**
 * Reports whether an asynchronous registration accepts the three Nest shapes.
 *
 * A `useFactory` returning a value, a `useClass` implementing the factory
 * method, and a `useExisting` provider are the three arms a
 * `ConfigurableModuleAsyncOptions` states. Each must produce a definition that
 * names its module and provides the options token.
 *
 * @param registerAsync - The module's `forRootAsync` (or equivalent) method.
 * @param moduleClass - The module class the registration belongs to, used as the
 *   method's receiver so a static registration builds its definition from `this`.
 * @param token - The options token the registration must provide.
 * @returns The broken shapes and rules, frozen.
 */
export function asyncRegistrationShapeIssues<TModule>(
  registerAsync: (this: TModule, options: never) => DynamicModule,
  moduleClass: TModule,
  token: Token<unknown>,
): readonly string[] {
  const issues: string[] = [];
  class FactoryClass {
    create(): object {
      return {};
    }
  }

  const cases = [
    ["useFactory", { useFactory: () => ({}) }],
    ["useClass", { useClass: FactoryClass }],
    ["useExisting", { useExisting: FactoryClass }],
  ] as const;

  for (const [name, options] of cases) {
    try {
      const definition = registerAsync.call(moduleClass, options as never);
      for (const issue of dynamicModuleIssues(definition, moduleClass as object)) {
        issues.push(`${name}:${issue}`);
      }
      if (!(definition.providers ?? []).some((provider) => providerToken(provider) === token)) {
        issues.push(`${name}:options token`);
      }
    } catch (error) {
      issues.push(`${name}:threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return Object.freeze(issues);
}

/**
 * Reports whether a module's teardown is idempotent.
 *
 * A test kit that closes a module twice must not run a pool's teardown twice;
 * the second call has to resolve without throwing.
 *
 * @param close - The module's close method.
 * @returns The teardown issues, frozen.
 */
export async function teardownIssues(close: () => Promise<void>): Promise<readonly string[]> {
  const issues: string[] = [];
  try {
    await close();
    await close();
  } catch (error) {
    issues.push(`threw ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze(issues);
}

function providerToken(provider: unknown): unknown {
  return typeof provider === "object" && provider !== null && "provide" in provider
    ? (provider as { readonly provide: unknown }).provide
    : provider;
}
