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
/** Pre-compiled path matcher for one middleware rule. */
type CompiledPathMatcher = (pathname: string) => boolean;

interface CompiledMiddlewareRule {
  readonly method: string | undefined;
  readonly matchPath: CompiledPathMatcher;
}

/** Pre-compiled middleware configuration avoiding per-request reflection and path splitting. */
export interface CompiledMiddlewareConfig {
  readonly middleware: readonly AponiaMiddleware[];
  readonly targets: readonly CompiledMiddlewareRule[];
  readonly excluded: readonly CompiledMiddlewareRule[];
}

function compilePathMatcher(pattern: string): CompiledPathMatcher {
  const normalizedPattern = normalizeMiddlewarePath(pattern);
  if (normalizedPattern === "/*" || normalizedPattern === "*") {
    return () => true;
  }
  if (normalizedPattern.endsWith("/*")) {
    const base = normalizedPattern.slice(0, -2);
    const prefixSlash = `${base}/`;
    return (pathname) => {
      const p = normalizeMiddlewarePath(pathname);
      return p === base || p.startsWith(prefixSlash);
    };
  }
  if (!normalizedPattern.includes(":") && !normalizedPattern.includes("*")) {
    const prefixSlash = `${normalizedPattern}/`;
    return (pathname) => {
      const p = normalizeMiddlewarePath(pathname);
      return p === normalizedPattern || p.startsWith(prefixSlash);
    };
  }

  const patternSegments = normalizedPattern.split("/").filter(Boolean);
  const exactPrefixSlash = `${normalizedPattern}/`;
  return (pathname) => {
    const normalizedPath = normalizeMiddlewarePath(pathname);
    if (normalizedPath === normalizedPattern || normalizedPath.startsWith(exactPrefixSlash)) {
      return true;
    }
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    if (patternSegments.length !== pathSegments.length) {
      return false;
    }
    for (let i = 0; i < patternSegments.length; i += 1) {
      const seg = patternSegments[i]!;
      if (seg.startsWith(":") || seg === "*") {
        continue;
      }
      if (seg !== pathSegments[i]) {
        return false;
      }
    }
    return true;
  };
}

function compileTargetRule(target: RouteTarget): CompiledMiddlewareRule {
  if (typeof target === "string") {
    return { method: undefined, matchPath: compilePathMatcher(target) };
  }
  if (typeof target === "function") {
    const metadata = getControllerMetadata(target as ClassToken<unknown>);
    if (metadata?.path === undefined) {
      return { method: undefined, matchPath: () => false };
    }
    return metadata.path === "" || metadata.path === "/"
      ? { method: undefined, matchPath: () => true }
      : { method: undefined, matchPath: compilePathMatcher(metadata.path) };
  }
  if (typeof target === "object" && target !== null && "path" in target) {
    const descriptor = target as { readonly path: string; readonly method?: RequestMethod };
    return {
      method: descriptor.method?.toUpperCase(),
      matchPath: compilePathMatcher(descriptor.path),
    };
  }
  return { method: undefined, matchPath: () => false };
}

function compileExcludedRule(
  item: string | { readonly path: string; readonly method?: RequestMethod },
): CompiledMiddlewareRule {
  if (typeof item === "string") {
    return { method: undefined, matchPath: compilePathMatcher(item) };
  }
  return {
    method: item.method?.toUpperCase(),
    matchPath: compilePathMatcher(item.path),
  };
}

function matchesCompiledRule(
  rule: CompiledMiddlewareRule,
  pathname: string,
  upperMethod: string,
): boolean {
  if (rule.method !== undefined && rule.method !== upperMethod) {
    return false;
  }
  return rule.matchPath(pathname);
}

/**
 * Compiles middleware configs once at boot so request matching never reads
 * `reflect-metadata` or re-splits static patterns.
 *
 * @internal
 */
export function compileMiddlewareConfigs(
  configs: readonly {
    readonly middleware: readonly unknown[];
    readonly targets: readonly RouteTarget[];
    readonly excluded: readonly (
      | string
      | { readonly path: string; readonly method?: RequestMethod }
    )[];
  }[],
): readonly CompiledMiddlewareConfig[] {
  return Object.freeze(
    configs.map((entry) =>
      Object.freeze({
        middleware: entry.middleware as readonly AponiaMiddleware[],
        targets: Object.freeze(entry.targets.map(compileTargetRule)),
        excluded: Object.freeze(entry.excluded.map(compileExcludedRule)),
      }),
    ),
  );
}

/**
 * Executes a pre-compiled middleware configuration list against one request.
 *
 * @internal
 */
export async function runCompiledMiddlewareChain(
  configs: readonly CompiledMiddlewareConfig[],
  context: object,
  pathname: string,
  method: string,
  next: () => Promise<unknown>,
): Promise<unknown> {
  const upperMethod = method.toUpperCase();
  let chain: AponiaMiddleware[] | undefined;

  for (let i = 0; i < configs.length; i += 1) {
    const entry = configs[i]!;
    let excluded = false;
    for (let j = 0; j < entry.excluded.length; j += 1) {
      if (matchesCompiledRule(entry.excluded[j]!, pathname, upperMethod)) {
        excluded = true;
        break;
      }
    }
    if (excluded) {
      continue;
    }

    let matched = false;
    for (let j = 0; j < entry.targets.length; j += 1) {
      if (matchesCompiledRule(entry.targets[j]!, pathname, upperMethod)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      chain ??= [];
      chain.push(...entry.middleware);
    }
  }

  if (chain === undefined || chain.length === 0) {
    return await next();
  }

  let index = 0;
  const run = async (): Promise<unknown> => {
    if (index >= chain.length) {
      return await next();
    }
    const current = chain[index++]!;
    return await current.use(context as never, run);
  };
  return await run();
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
  return await runCompiledMiddlewareChain(
    compileMiddlewareConfigs(configs),
    context,
    pathname,
    method,
    next,
  );
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
