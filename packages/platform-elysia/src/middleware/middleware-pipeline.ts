import {
  AponiaError,
  type AponiaMiddleware,
  type ClassToken,
  type RequestMethod,
  type RouteContext,
  type RouteTarget,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { Elysia } from "elysia";
import type { ResolvedMiddlewareConfig } from "./middleware-consumer.types.ts";
import { isRouteExcluded, matchRouteTarget } from "./middleware-matcher.ts";

/**
 * A prepared pipeline entry whose middleware classes have been resolved.
 */
interface ResolvedPipelineEntry {
  readonly middleware: readonly AponiaMiddleware[];
  readonly targets: readonly RouteTarget[];
  readonly excluded: readonly (
    | string
    | { readonly path: string; readonly method?: RequestMethod }
  )[];
}

/**
 * Resolves a middleware class constructor or returns an existing middleware instance.
 *
 * @param entry - The middleware class or instance.
 * @param container - Optional container for resolving injected dependencies.
 * @returns The resolved AponiaMiddleware instance.
 */
export function resolveMiddleware(
  entry: ClassToken<AponiaMiddleware> | AponiaMiddleware,
  container?: AponiaContainer,
): AponiaMiddleware {
  if (typeof entry === "function") {
    if (container !== undefined) {
      try {
        const instance = container.get(entry);
        if (
          typeof instance === "object" &&
          instance !== null &&
          typeof (instance as { use?: unknown }).use === "function"
        ) {
          return instance as AponiaMiddleware;
        }
      } catch {
        // Fall back to direct instantiation
      }
    }

    try {
      const instance = Reflect.construct(entry, []) as AponiaMiddleware;
      if (typeof instance.use === "function") {
        return instance;
      }
    } catch {
      throw new AponiaError(
        "INVALID_MIDDLEWARE",
        `Could not instantiate middleware class "${entry.name}". Ensure its constructor is registered in a module or has no dependencies.`,
        { middleware: entry.name },
      );
    }
  }

  if (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { use?: unknown }).use === "function"
  ) {
    return entry as AponiaMiddleware;
  }

  throw new AponiaError(
    "INVALID_MIDDLEWARE",
    "Provided middleware does not implement AponiaMiddleware.",
  );
}

/**
 * Mounts middleware configurations onto an Elysia application instance.
 *
 * @param application - The native Elysia application.
 * @param configs - The resolved middleware configurations collected from modules.
 * @param container - Optional DI container for resolving middleware providers.
 */
export function mountMiddleware(
  application: Elysia,
  configs: readonly ResolvedMiddlewareConfig[],
  container?: AponiaContainer,
): void {
  if (configs.length === 0) {
    return;
  }

  const pipeline = Object.freeze(
    configs.map((config): ResolvedPipelineEntry => {
      const resolvedMiddleware = Object.freeze(
        config.middleware.map((entry) => resolveMiddleware(entry, container)),
      );
      return Object.freeze({
        middleware: resolvedMiddleware,
        targets: config.targets,
        excluded: config.excluded,
      });
    }),
  );

  application.request(async (elysiaContext: { request: Request; set: unknown; path?: string }) => {
    const url = new URL(elysiaContext.request.url);
    const pathname = elysiaContext.path ?? url.pathname;
    const method = elysiaContext.request.method;

    const matchingMiddleware: AponiaMiddleware[] = [];
    for (const entry of pipeline) {
      if (isRouteExcluded(entry.excluded, pathname, method)) {
        continue;
      }
      const matches = entry.targets.some((target) => matchRouteTarget(target, pathname, method));
      if (matches) {
        matchingMiddleware.push(...entry.middleware);
      }
    }

    if (matchingMiddleware.length === 0) {
      return undefined;
    }

    const routeContext = elysiaContext as unknown as RouteContext;
    let index = 0;
    const next = async (): Promise<unknown> => {
      if (index < matchingMiddleware.length) {
        const current = matchingMiddleware[index++];
        return await current.use(routeContext, next);
      }
      return undefined;
    };

    const result = await next();
    if (result instanceof Response) {
      return result;
    }
    return undefined;
  });
}
