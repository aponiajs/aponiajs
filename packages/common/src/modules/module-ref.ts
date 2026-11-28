import type { Token } from "../interfaces/token.interface.ts";

/** Options `ModuleRef.get` accepts. */
export interface ModuleRefGetOptions {
  /**
   * Resolve only what the receiving module can see.
   *
   * `true` is the default, which is Nest's `ModuleRef` behavior: a token the
   * graph holds but this module cannot reach raises `MISSING_PROVIDER`.
   * `false` searches the whole graph from the root.
   */
  readonly strict?: boolean;
  /** Return every instance of the token instead of the first. */
  readonly each?: boolean;
}

/**
 * Resolves providers from the module that receives it.
 *
 * A provider injects `ModuleRef` like any other dependency. `get` resolves a
 * cached instance visible to that module; `resolve` builds a request sub-tree
 * under a context id; `create` instantiates a class without caching it.
 */
export abstract class ModuleRef {
  /**
   * Resolves a token visible from the receiving module.
   *
   * @param token - The token to resolve.
   * @param options - Strictness and whether every instance is wanted.
   * @returns The resolved value.
   */
  abstract get<T>(token: Token<T>, options?: ModuleRefGetOptions): T;

  /**
   * Resolves a token inside a request sub-tree.
   *
   * A context id is created when none is passed, so two calls without one
   * produce two sub-trees. Passing the same id shares one.
   *
   * @param token - The token to resolve.
   * @param contextId - The context id the sub-tree hangs under.
   * @returns The resolved value for that context.
   */
  abstract resolve<T>(token: Token<T>, contextId?: object): T;

  /**
   * Instantiates a provider without reusing a cached instance.
   *
   * The receiving module's graph resolves the token; a request-scoped provider
   * needs the context, and every other lifetime produces a fresh instance even
   * when the container already holds one. Use it when the caller must own the
   * instance rather than share the application's.
   *
   * @param token - The provider token to instantiate.
   * @param contextId - The context id a request-scoped provider needs.
   * @returns A new instance.
   */
  abstract create<T>(token: Token<T>, contextId?: object): T;

  /**
   * Records the request object a context id resolves `REQUEST` to.
   *
   * @param request - The request object.
   * @param contextId - The context id the request resolves under.
   */
  abstract registerRequestByContextId<TRequest extends object>(
    request: TRequest,
    contextId: object,
  ): void;
}
