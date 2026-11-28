import type { ModuleDefinition } from "@aponiajs/common";
import type { AnyElysia } from "elysia";
import {
  createVersionNegotiator,
  type AponiaVersioningOptions,
  type VersionNegotiationRoute,
} from "@aponiajs/common";

/**
 * Routes a header or media-type request to the versioned mount of its path.
 *
 * The negotiator itself is shared with every platform; this function only
 * collects the compiled routes and installs the wrapper on Elysia's fetch
 * boundary. Because the rewrite happens before routing, the selected route's
 * hooks, plugins, and validation run exactly as they would for a request that
 * named the versioned path.
 *
 * `Accept` parameters and the version header are matched against the table the
 * boot compiled, so a version a controller never declared is refused rather
 * than silently served by another version. A path with no versioned handler is
 * forwarded untouched, which keeps neutral routes and native plugin routes
 * outside version negotiation.
 *
 * @internal
 */
export function installVersionRouting(
  application: AnyElysia,
  modules: readonly ModuleDefinition[],
  options: AponiaVersioningOptions | undefined,
  routePrefix = "",
): void {
  const routes: VersionNegotiationRoute[] = [];
  for (const module of modules) {
    for (const controller of module.controllers) {
      const compiledRoutes =
        (
          controller as unknown as {
            readonly compiledRoutes?: readonly VersionNegotiationRoute[];
          }
        ).compiledRoutes ?? [];
      routes.push(...compiledRoutes);
    }
  }

  const negotiate = createVersionNegotiator(routes, options, routePrefix);
  if (negotiate === undefined) {
    return;
  }

  const wrapper =
    (fetch: (request: Request, ...rest: unknown[]) => Response | Promise<Response>) =>
    async (request: Request, ...rest: unknown[]): Promise<Response> => {
      const negotiated = negotiate(request);
      if (negotiated instanceof Response) {
        return negotiated;
      }
      return await fetch(negotiated ?? request, ...rest);
    };

  (
    application as unknown as {
      wrap: (factory: typeof wrapper) => unknown;
    }
  ).wrap(wrapper);
}
