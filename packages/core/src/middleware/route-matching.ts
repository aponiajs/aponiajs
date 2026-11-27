import {
  getControllerMetadata,
  type AponiaMiddleware,
  type ClassToken,
  type MiddlewareConsumer,
  type RequestMethod,
  type RouteTarget,
} from "@aponiajs/common";
import { AponiaError } from "@aponiajs/common";
import type { AponiaContainer } from "../injector/container.ts";

/**
 * Normalizes a path for middleware matching: one leading slash, no trailing one.
 *
 * @param path - The declared or requested path.
 * @returns The normalized path.
 */
export function normalizeMiddlewarePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Whether a route pattern (`:param`, `*`, literal segments) matches a path. */
export function matchesMiddlewarePath(pattern: string, pathname: string): boolean {
  const normalizedPattern = normalizeMiddlewarePath(pattern);
  const normalizedPath = normalizeMiddlewarePath(pathname);

  if (normalizedPattern === "/*" || normalizedPattern === "*") {
    return true;
  }
  if (normalizedPattern.endsWith("/*")) {
    const base = normalizedPattern.slice(0, -2);
    return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
  }
  if (normalizedPattern === normalizedPath) {
    return true;
  }
  if (normalizedPath.startsWith(`${normalizedPattern}/`)) {
    return true;
  }

  const patternSegments = normalizedPattern.split("/").filter(Boolean);
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every(
    (segment, index) =>
      segment.startsWith(":") || segment === "*" || segment === pathSegments[index],
  );
}

/** Whether a request target (path, controller class, or route) matches. */
export function matchesMiddlewareTarget(
  target: RouteTarget,
  pathname: string,
  method: string,
): boolean {
  if (typeof target === "string") {
    return matchesMiddlewarePath(target, pathname);
  }

  if (typeof target === "function") {
    const metadata = getControllerMetadata(target as ClassToken<unknown>);
    if (metadata?.path === undefined) {
      return false;
    }
    // A controller declared without a path owns the whole path space: its
    // handler paths are mounted from the root. Matching only "/" would skip
    // every route such a controller declares.
    return metadata.path === "" || metadata.path === "/"
      ? true
      : matchesMiddlewarePath(metadata.path, pathname);
  }

  if (typeof target === "object" && target !== null && "path" in target) {
    const descriptor = target as { readonly path: string; readonly method?: RequestMethod };
    if (
      descriptor.method !== undefined &&
      descriptor.method.toUpperCase() !== method.toUpperCase()
    ) {
      return false;
    }
    return matchesMiddlewarePath(descriptor.path, pathname);
  }

  return false;
}

/** Whether one excluded route rule excludes the request. */
export function isMiddlewareRouteExcluded(
  excluded: readonly (string | { readonly path: string; readonly method?: RequestMethod })[],
  pathname: string,
  method: string,
): boolean {
  return excluded.some((item) => {
    if (typeof item === "string") {
      return matchesMiddlewarePath(item, pathname);
    }
    if (item.method !== undefined && item.method.toUpperCase() !== method.toUpperCase()) {
      return false;
    }
    return matchesMiddlewarePath(item.path, pathname);
  });
}

/**
 * Resolves one middleware class or instance through the container.
 *
 * A class the graph provides is resolved through the container, so a middleware
 * may inject dependencies. A class with no graph entry and no constructor
 * arguments is built directly, which is the low-level escape hatch. A class
 * with constructor arguments the graph cannot resolve is refused rather than
 * constructed with `undefined`.
 */
export function resolveMiddlewareInstance(
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
        // Fall through to the constructor fallback.
      }
    }

    if (entry.length > 0) {
      throw new AponiaError(
        "INVALID_MIDDLEWARE",
        `Middleware class "${entry.name}" declares ${entry.length} constructor parameter(s). Register it as a provider the root can reach, or pass an instance.`,
        { middleware: entry.name },
      );
    }

    try {
      const instance = Reflect.construct(entry, []) as AponiaMiddleware;
      if (typeof instance.use === "function") {
        return instance;
      }
    } catch {
      throw new AponiaError(
        "INVALID_MIDDLEWARE",
        `Could not instantiate middleware class "${entry.name}". Register it as a provider or give its constructor no arguments.`,
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
 * Runs the middleware configurations that match one request.
 *
 * Each middleware receives the platform context and a `next` callback; the
 * returned value is what the route pipeline continues with.
 */
export async function runMiddlewareChain(
  configs: readonly {
    readonly middleware: readonly unknown[];
    readonly targets: readonly RouteTarget[];
    readonly excluded: readonly (
      | string
      | { readonly path: string; readonly method?: RequestMethod }
    )[];
  }[],
  context: object,
  pathname: string,
  method: string,
  next: () => Promise<unknown>,
): Promise<unknown> {
  const chain: AponiaMiddleware[] = [];
  for (const entry of configs) {
    if (isMiddlewareRouteExcluded(entry.excluded, pathname, method)) {
      continue;
    }
    if (entry.targets.some((target) => matchesMiddlewareTarget(target, pathname, method))) {
      chain.push(...(entry.middleware as readonly AponiaMiddleware[]));
    }
  }
  if (chain.length === 0) {
    return await next();
  }

  let index = 0;
  const run = async (): Promise<unknown> => {
    if (index >= chain.length) {
      return await next();
    }
    const current = chain[index++];
    return await current.use(context as never, run);
  };
  return await run();
}

/**
 * Collects the middleware configurations every module declares.
 *
 * A module class's `configure(consumer)` is called once per boot, exactly as
 * Nest calls it while the application is created.
 */
export function collectModuleMiddleware(
  modules: readonly {
    readonly id: string;
    readonly moduleClass?: unknown;
    readonly configure?: unknown;
  }[],
  container: AponiaContainer,
  consumer: MiddlewareConsumer,
): void {
  for (const module of modules) {
    if (typeof module.configure === "function") {
      (module.configure as (consumer: MiddlewareConsumer) => void)(consumer);
      continue;
    }
    const moduleClass = module.moduleClass;
    if (typeof moduleClass !== "function") {
      continue;
    }
    const prototype = (moduleClass as { readonly prototype?: { configure?: unknown } }).prototype;
    if (typeof prototype?.configure !== "function") {
      continue;
    }
    try {
      const instance = container.get(moduleClass as never) as {
        configure?: (consumer: MiddlewareConsumer) => void;
      };
      instance.configure?.(consumer);
    } catch {
      const instance = Reflect.construct(moduleClass as never, []) as {
        configure?: (consumer: MiddlewareConsumer) => void;
      };
      instance.configure?.(consumer);
    }
  }
}
