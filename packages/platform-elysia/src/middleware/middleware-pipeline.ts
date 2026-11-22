import {
  resolveMiddlewareInstance,
  runMiddlewareChain,
  stripRoutePrefix,
  type ResolvedMiddlewareConfig,
} from "@aponiajs/platform-core";
import type { AponiaContainer } from "@aponiajs/core";
import type { Elysia } from "elysia";

/**
 * Resolves a middleware class constructor or returns an existing middleware instance.
 *
 * The resolution is the shared one every platform uses, re-exported here for the
 * package's own call sites.
 */
export const resolveMiddleware = resolveMiddlewareInstance;

/**
 * Mounts middleware configurations onto an Elysia application instance.
 *
 * Elysia's own router decides which route answers; the chain that runs before it
 * is `@aponiajs/platform-core`'s, so one middleware behaves the same on every
 * platform.
 *
 * @param application - The native Elysia application.
 * @param configs - The resolved middleware configurations collected from modules.
 * @param container - Optional DI container for resolving middleware providers.
 * @param prefix - The route prefix the application mounts under.
 */
export function mountMiddleware(
  application: Elysia,
  configs: readonly ResolvedMiddlewareConfig[],
  container?: AponiaContainer,
  prefix = "",
): void {
  if (configs.length === 0) {
    return;
  }

  const pipeline = Object.freeze(
    configs.map((config) =>
      Object.freeze({
        middleware: Object.freeze(
          config.middleware.map((entry) => resolveMiddleware(entry, container)),
        ),
        targets: config.targets,
        excluded: config.excluded,
      }),
    ),
  );

  application.onRequest(
    async (elysiaContext: { request: Request; path?: string }): Promise<Response | undefined> => {
      const url = new URL(elysiaContext.request.url);
      const pathname = stripRoutePrefix(elysiaContext.path ?? url.pathname, prefix);
      if (pathname === undefined) {
        return undefined;
      }

      const result = await runMiddlewareChain(
        pipeline,
        elysiaContext,
        pathname,
        elysiaContext.request.method,
        async () => undefined,
      );

      return result instanceof Response ? result : undefined;
    },
  );
}
