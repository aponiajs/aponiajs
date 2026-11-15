import {
  AponiaError,
  getTokenName,
  isOptionalInjection,
  ModuleRef,
  resolveForwardRef,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { getProviderDependencies } from "./dependencies.ts";
import { formatMissingProviderDiagnostic } from "./diagnostic-formatter.ts";
import type { GraphInspection, ProviderLocation } from "./graph.types.ts";

/**
 * The compiled module graph: every module reachable from the root, in
 * post-order, with memoized token resolution.
 *
 * Construct through {@link compileModuleGraph}, which validates before any
 * instance exists.
 */
export class ModuleGraph {
  /** The root the walk started from; `get` resolves against this module. */
  readonly root: ModuleDefinition;
  /** Every reachable module, once each, in post-order. */
  readonly modules: readonly ModuleDefinition[];
  /** Every module declared as global whose exports are available everywhere. */
  readonly globalModules: readonly ModuleDefinition[];

  readonly #moduleSet: ReadonlySet<ModuleDefinition>;
  readonly #providersByModule: ReadonlyMap<ModuleDefinition, ReadonlyMap<Token<unknown>, Provider>>;
  readonly #exportsByModule: ReadonlyMap<ModuleDefinition, ReadonlySet<Token<unknown>>>;
  readonly #predefinedProviders: ReadonlyMap<Token<unknown>, Provider>;
  readonly #locationsByModule = new Map<ModuleDefinition, Map<Token<unknown>, ProviderLocation>>();
  readonly #requestRequired = new WeakMap<ModuleDefinition, Map<Provider, boolean>>();

  constructor(
    root: ModuleDefinition,
    modules: readonly ModuleDefinition[],
    predefined?: readonly Provider[],
  ) {
    this.root = root;
    this.modules = Object.freeze([...modules]);
    this.globalModules = Object.freeze(modules.filter((module) => module.global === true));
    this.#moduleSet = new Set(modules);
    this.#providersByModule = new Map(
      modules.map((module) => [
        module,
        new Map(module.providers.map((provider) => [provider.provide, provider])),
      ]),
    );
    this.#exportsByModule = new Map(modules.map((module) => [module, new Set(module.exports)]));
    this.#predefinedProviders = new Map(
      (predefined ?? []).map((provider) => [provider.provide, provider]),
    );
  }

  inspect(): GraphInspection {
    return Object.freeze({
      root: this.root.id,
      modules: Object.freeze(
        this.modules.map((module) =>
          Object.freeze({
            id: module.id,
            imports: Object.freeze(module.imports.map((item) => resolveForwardRef(item).id)),
            controllers: Object.freeze(
              module.controllers.map((controller) => getTokenName(controller.token)),
            ),
            providers: Object.freeze(
              module.providers.map((provider) => getTokenName(provider.provide)),
            ),
            exports: Object.freeze(module.exports.map(getTokenName)),
          }),
        ),
      ),
    });
  }

  /**
   * Whether a provider needs an active request context to be constructed.
   *
   * True for a provider that declares `"request"` scope and for one whose
   * dependencies reach such a provider: the scope bubbles outward along the
   * injection chain, as Nest does, so a provider declared as a singleton that
   * depends on request state is instantiated per request instead of being
   * refused.
   *
   * @param module - The module the provider is declared in.
   * @param provider - The provider to inspect.
   * @returns Whether construction requires a request context.
   *
   * @internal
   */
  requiresRequestContext(module: ModuleDefinition, provider: Provider): boolean {
    const cached = this.#requestRequired.get(module)?.get(provider);
    if (cached !== undefined) {
      return cached;
    }

    // Two passes: the first caches only the true answers, so a node reached
    // while its own dependency cycle is being walked cannot memoize a false
    // that a later branch would have corrected. The second pass caches the
    // rest, now that every true answer it could reach is known.
    this.#walkRequestScopes(false);
    this.#walkRequestScopes(true);
    return this.#requestRequired.get(module)?.get(provider) ?? false;
  }

  #walkRequestScopes(cacheFalses: boolean): void {
    for (const module of this.modules) {
      for (const provider of module.providers) {
        this.#requiresRequest(module, provider, new Set(), cacheFalses);
      }
    }
  }

  #requiresRequest(
    module: ModuleDefinition,
    provider: Provider,
    visiting: Set<Provider>,
    cacheFalses: boolean,
  ): boolean {
    const cached = this.#requestRequired.get(module)?.get(provider);
    if (cached !== undefined) {
      return cached;
    }

    const remember = (value: boolean): boolean => {
      if (value || cacheFalses) {
        let moduleScopes = this.#requestRequired.get(module);
        if (!moduleScopes) {
          moduleScopes = new Map();
          this.#requestRequired.set(module, moduleScopes);
        }
        moduleScopes.set(provider, value);
      }
      return value;
    };

    if (provider.scope === "request") {
      return remember(true);
    }
    if (visiting.has(provider)) {
      return false;
    }

    visiting.add(provider);
    try {
      for (const dependency of getProviderDependencies(provider)) {
        const optional = isOptionalInjection(dependency);
        const token = resolveForwardRef(optional ? dependency.token : dependency);
        if (token === ModuleRef) {
          continue;
        }
        let location: ProviderLocation;
        try {
          location = this.locate(module, token);
        } catch (error) {
          if (optional && error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
            continue;
          }
          throw error;
        }
        if (this.#requiresRequest(location.module, location.provider, visiting, cacheFalses)) {
          return remember(true);
        }
      }
    } finally {
      visiting.delete(provider);
    }

    return remember(false);
  }

  /**
   * Resolves a token to the module and provider that own it.
   *
   * The module's own providers win; imports are consulted only when they
   * export the token. Two importers that resolve to different modules fail
   * with `AMBIGUOUS_PROVIDER`; two that re-export one shared provider agree.
   * Resolutions are memoized per module.
   *
   * @param module - The module to resolve from.
   * @param token - The token to resolve.
   * @returns The frozen location owning the token.
   * @throws An `AponiaError` with `MISSING_PROVIDER` or `AMBIGUOUS_PROVIDER`.
   *
   * @example
   * ```ts
   * const location = graph.locate(module, GREETING);
   * ```
   */
  locate(module: ModuleDefinition, token: Token<unknown>): ProviderLocation {
    if (!this.#moduleSet.has(module)) {
      throw new AponiaError(
        "MISSING_PROVIDER",
        `Module "${module.id}" is not part of the compiled graph.`,
        {
          module: module.id,
          token: getTokenName(token),
          hints: Object.freeze([`Ensure module "${module.id}" is imported by the root module.`]),
        },
      );
    }

    const cached = this.#locationsByModule.get(module)?.get(token);
    if (cached) {
      return cached;
    }

    const location = this.#locate(module, token, new Set());
    this.#cacheLocation(module, token, location);
    return location;
  }

  #locate(
    module: ModuleDefinition,
    token: Token<unknown>,
    visited: Set<ModuleDefinition>,
  ): ProviderLocation {
    const cached = this.#locationsByModule.get(module)?.get(token);
    if (cached) {
      return cached;
    }

    const own = this.#providersByModule.get(module)?.get(token);
    if (own) {
      const location = Object.freeze({ module, provider: own });
      this.#cacheLocation(module, token, location);
      return location;
    }

    if (visited.has(module)) {
      throw this.#missingProvider(module, token);
    }
    visited.add(module);

    try {
      const candidates = new Map<ModuleDefinition, ProviderLocation>();
      for (const rawImport of module.imports) {
        const imported = resolveForwardRef(rawImport);
        if (!this.#exportsByModule.get(imported)?.has(token)) {
          continue;
        }

        const location = this.#locate(imported, token, visited);
        candidates.set(location.module, location);
      }

      if (candidates.size === 0) {
        const globalCandidates = new Map<ModuleDefinition, ProviderLocation>();
        for (const globalMod of this.globalModules) {
          if (globalMod === module) {
            continue;
          }
          if (this.#exportsByModule.get(globalMod)?.has(token)) {
            const location = this.#locate(globalMod, token, visited);
            globalCandidates.set(location.module, location);
          }
        }

        if (globalCandidates.size === 1) {
          const location = globalCandidates.values().next().value;
          if (location) {
            this.#cacheLocation(module, token, location);
            return location;
          }
        }

        if (globalCandidates.size > 1) {
          throw new AponiaError(
            "AMBIGUOUS_PROVIDER",
            `Token "${getTokenName(token)}" is exported by multiple global modules: ${[...globalCandidates.values()].map((item) => item.module.id).join(", ")}.`,
            {
              module: module.id,
              token: getTokenName(token),
              candidates: [...globalCandidates.values()].map((item) => item.module.id),
            },
          );
        }

        const predefined = this.#predefinedProviders.get(token);
        if (predefined) {
          const location = Object.freeze({ module: this.root, provider: predefined });
          this.#cacheLocation(module, token, location);
          return location;
        }
        throw this.#missingProvider(module, token);
      }

      if (candidates.size > 1) {
        throw new AponiaError(
          "AMBIGUOUS_PROVIDER",
          `Token "${getTokenName(token)}" is exported by multiple imports of module "${module.id}".`,
          {
            module: module.id,
            token: getTokenName(token),
            candidates: [...candidates.values()].map((item) => item.module.id),
          },
        );
      }

      const location = candidates.values().next().value;
      if (!location) {
        throw this.#missingProvider(module, token);
      }

      this.#cacheLocation(module, token, location);
      return location;
    } finally {
      visited.delete(module);
    }
  }

  #cacheLocation(
    module: ModuleDefinition,
    token: Token<unknown>,
    location: ProviderLocation,
  ): void {
    let moduleLocations = this.#locationsByModule.get(module);
    if (!moduleLocations) {
      moduleLocations = new Map();
      this.#locationsByModule.set(module, moduleLocations);
    }
    moduleLocations.set(token, location);
  }

  #missingProvider(module: ModuleDefinition, token: Token<unknown>): AponiaError {
    const tokenDescription = getTokenName(token);
    const hints: string[] = [];

    const declaringModules = this.modules.filter((m) =>
      m.providers.some((p) => p.provide === token),
    );

    if (declaringModules.length === 0) {
      hints.push(
        `No module in the compiled graph declares token "${tokenDescription}". Did you forget to add it to "${module.id}.providers" or import a module providing it?`,
      );
    } else {
      for (const declaring of declaringModules) {
        const isImported = module.imports.some(
          (rawImport) => resolveForwardRef(rawImport) === declaring,
        );
        const isExported = declaring.exports.includes(token);

        if (declaring.global && !isExported) {
          hints.push(
            `Module "${declaring.id}" is marked as global, but does not export "${tokenDescription}". Add "${tokenDescription}" to "${declaring.id}.exports".`,
          );
        } else if (isImported && !isExported) {
          hints.push(
            `Token "${tokenDescription}" is declared in imported module "${declaring.id}", but "${declaring.id}" does not export it. Add "${tokenDescription}" to "${declaring.id}.exports".`,
          );
        } else if (!isImported && isExported) {
          hints.push(
            `Token "${tokenDescription}" is exported by module "${declaring.id}", but "${module.id}" does not import "${declaring.id}". Add "${declaring.id}" to "${module.id}.imports".`,
          );
        } else if (!isImported && !isExported) {
          hints.push(
            `Token "${tokenDescription}" is declared in module "${declaring.id}". Add "${declaring.id}" to "${module.id}.imports" and add "${tokenDescription}" to "${declaring.id}.exports".`,
          );
        }
      }
    }

    const hintSection =
      hints.length > 0 ? ` Hints:\n${hints.map((h) => `  - ${h}`).join("\n")}` : "";

    const declaring = declaringModules[0];
    const isImported = declaring
      ? module.imports.some((rawImport) => resolveForwardRef(rawImport) === declaring)
      : undefined;
    const isExported = declaring ? declaring.exports.includes(token) : undefined;

    const diagnostic = formatMissingProviderDiagnostic({
      token: tokenDescription,
      requestingModule: module.id,
      declaringModule: declaring?.id,
      isImported,
      isExported,
    });

    return new AponiaError(
      "MISSING_PROVIDER",
      `${diagnostic}\n\nModule "${module.id}" cannot resolve token "${tokenDescription}".${hintSection}`,
      {
        module: module.id,
        token: tokenDescription,
        hints: Object.freeze(hints),
        diagnostic,
      },
    );
  }
}
