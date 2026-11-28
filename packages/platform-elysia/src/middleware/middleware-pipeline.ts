import { slicePathname, stripRoutePrefix, type ResolvedMiddlewareConfig } from "@aponiajs/common";
import {
  compileMiddlewareConfigs,
  resolveMiddlewareInstance,
  runCompiledMiddlewareChain,
} from "@aponiajs/core";
import type { AponiaContainer } from "@aponiajs/core";
import type { Elysia } from "elysia";

/**
 * Resolves a middleware class constructor or returns an existing middleware instance.
 *
 * The resolution is the shared one every platform uses, re-exported here for the
 * package's own call sites.
 */
export const resolveMiddleware = resolveMiddlewareInstance;

const NOOP_NEXT = (): Promise<unknown> => Promise.resolve(undefined);

/**
 * Mounts middleware configurations onto an Elysia application instance.
 *
 * Elysia's own router decides which route answers; the chain that runs before it
 * is `@aponiajs/core`'s, so one middleware behaves the same on every
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

  const compiled = compileMiddlewareConfigs(
    configs.map((config) => ({
      middleware: config.middleware.map((entry) => resolveMiddleware(entry, container)),
      targets: config.targets,
      excluded: config.excluded,
    })),
  );

  application.onRequest(
    (elysiaContext: {
      request: Request;
      path?: string;
    }): Response | undefined | Promise<Response | undefined> => {
      const pathname = stripRoutePrefix(
        elysiaContext.path ?? slicePathname(elysiaContext.request.url),
        prefix,
      );
      if (pathname === undefined) {
        return undefined;
      }

      const result = runCompiledMiddlewareChain(
        compiled,
        elysiaContext,
        pathname,
        elysiaContext.request.method,
        NOOP_NEXT,
      );

      if (result instanceof Response) {
        return result;
      }
      if (
        result !== null &&
        typeof result === "object" &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<unknown>).then((resolved) =>
          resolved instanceof Response ? resolved : undefined,
        );
      }
      return undefined;
    },
  );
}
