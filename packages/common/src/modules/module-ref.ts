import type { Token } from "../tokens/token.types.ts";

/**
 * Resolves providers from the module that receives it.
 *
 * A provider injects `ModuleRef` like any other dependency. `get` resolves a
 * token visible to that module; `resolve` accepts the request context a
 * request-scoped provider needs.
 */
export abstract class ModuleRef {
  /**
   * Resolves a token visible from the receiving module.
   *
   * @param token - The token to resolve.
   * @returns The resolved value.
   */
  abstract get<T>(token: Token<T>): T;

  /**
   * Resolves a token, optionally for one request context.
   *
   * @param token - The token to resolve.
   * @param context - The request context a request-scoped provider needs.
   * @returns The resolved value.
   */
  abstract resolve<T>(token: Token<T>, context?: object): T;
}
