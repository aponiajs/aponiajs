import { addRoute, createRouter, findRoute } from "rou3";
import { decode } from "./request-decoding.ts";
import type { MountedRoute, RouteMatch } from "../interfaces/kernel.interface.ts";

/** Resolves a method and path to the route one platform mounted. */
export interface RouteMatcher {
  /**
   * Finds the most specific route for a request.
   *
   * @param method - The request method, in any case.
   * @param pathname - The percent-encoded path, as `URL.pathname` states it.
   * @returns The match, or `undefined` when no route answers.
   */
  match(method: string, pathname: string): RouteMatch | undefined;
}

/**
 * Builds the matcher one kernel serves requests through.
 *
 * The router is `rou3`'s radix tree: `:param`, optional and wildcard segments,
 * and one entry per method. A route declared with `@All()` is registered under
 * the empty method, which answers every method.
 *
 * @param routes - The mounts to index.
 * @returns The frozen matcher.
 */
export function createRouteMatcher(routes: readonly MountedRoute[]): RouteMatcher {
  const router = createRouter<MountedRoute>();
  for (const mount of routes) {
    addRoute(
      router,
      mount.route.method === "ALL" ? "" : mount.route.method,
      mount.route.path,
      mount,
    );
  }

  return Object.freeze({
    match(method: string, pathname: string): RouteMatch | undefined {
      const found = findRoute(router, method.toUpperCase(), pathname);
      if (found === undefined) {
        return undefined;
      }

      const params: Record<string, string> = {};
      for (const [name, value] of Object.entries(found.params ?? {})) {
        params[name] = decode(value);
      }

      return Object.freeze({
        mount: found.data,
        params: Object.freeze(params),
      });
    },
  });
}
