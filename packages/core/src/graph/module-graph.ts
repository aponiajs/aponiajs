import {
  AponiaError,
  getTokenName,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";
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

  readonly #moduleSet: ReadonlySet<ModuleDefinition>;
  readonly #providersByModule: ReadonlyMap<ModuleDefinition, ReadonlyMap<Token<unknown>, Provider>>;
  readonly #exportsByModule: ReadonlyMap<ModuleDefinition, ReadonlySet<Token<unknown>>>;
  readonly #locationsByModule = new Map<ModuleDefinition, Map<Token<unknown>, ProviderLocation>>();

  constructor(root: ModuleDefinition, modules: readonly ModuleDefinition[]) {
    this.root = root;
    this.modules = Object.freeze([...modules]);
    this.#moduleSet = new Set(modules);
    this.#providersByModule = new Map(
      modules.map((module) => [
        module,
        new Map(module.providers.map((provider) => [provider.provide, provider])),
      ]),
    );
    this.#exportsByModule = new Map(modules.map((module) => [module, new Set(module.exports)]));
  }

  inspect(): GraphInspection {
    return Object.freeze({
      root: this.root.id,
      modules: Object.freeze(
        this.modules.map((module) =>
          Object.freeze({
            id: module.id,
            imports: Object.freeze(module.imports.map((item) => item.id)),
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
        { module: module.id, token: getTokenName(token) },
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
      throw missingProvider(module, token);
    }
    visited.add(module);

    try {
      const candidates = new Map<ModuleDefinition, ProviderLocation>();
      for (const imported of module.imports) {
        if (!this.#exportsByModule.get(imported)?.has(token)) {
          continue;
        }

        const location = this.#locate(imported, token, visited);
        candidates.set(location.module, location);
      }

      if (candidates.size === 0) {
        throw missingProvider(module, token);
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
        throw missingProvider(module, token);
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
}

function missingProvider(module: ModuleDefinition, token: Token<unknown>): AponiaError {
  return new AponiaError(
    "MISSING_PROVIDER",
    `Module "${module.id}" cannot resolve token "${getTokenName(token)}".`,
    { module: module.id, token: getTokenName(token) },
  );
}
