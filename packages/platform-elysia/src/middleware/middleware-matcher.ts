import {
  getControllerMetadata,
  type ClassToken,
  type RequestMethod,
  type RouteTarget,
} from "@aponiajs/common";

/**
 * Normalizes a URL path string to ensure leading slash and remove trailing slash.
 *
 * @param path - The path to normalize.
 * @returns The normalized path string.
 */
export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Matches a route path pattern against an actual request pathname.
 *
 * @param pattern - The route pattern (can include wildcard `*` or param `:id`).
 * @param pathname - The incoming request pathname.
 * @returns True if the pathname matches the pattern.
 */
export function matchPath(pattern: string, pathname: string): boolean {
  const normPattern = normalizePath(pattern);
  const normPath = normalizePath(pathname);

  if (normPattern === "/*" || normPattern === "*") {
    return true;
  }
  if (normPattern.endsWith("/*")) {
    const base = normPattern.slice(0, -2);
    return normPath === base || normPath.startsWith(`${base}/`);
  }
  if (normPattern === normPath) {
    return true;
  }
  if (normPath.startsWith(`${normPattern}/`)) {
    return true;
  }

  const patternSegments = normPattern.split("/").filter(Boolean);
  const pathSegments = normPath.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every(
    (segment, index) =>
      segment.startsWith(":") || segment === "*" || segment === pathSegments[index],
  );
}

/**
 * Determines whether an incoming request target matches a registered RouteTarget.
 *
 * @param target - The route target (string, controller class, or route object).
 * @param pathname - The incoming request pathname.
 * @param method - The HTTP request method.
 * @returns True if target matches the request.
 */
export function matchRouteTarget(target: RouteTarget, pathname: string, method: string): boolean {
  if (typeof target === "string") {
    return matchPath(target, pathname);
  }

  if (typeof target === "function") {
    const metadata = getControllerMetadata(target as ClassToken<unknown>);
    if (metadata?.path !== undefined) {
      return matchPath(metadata.path, pathname);
    }
    return false;
  }

  if (typeof target === "object" && target !== null && "path" in target) {
    const targetDescriptor = target as { readonly path: string; readonly method?: RequestMethod };
    if (
      targetDescriptor.method !== undefined &&
      targetDescriptor.method.toUpperCase() !== method.toUpperCase()
    ) {
      return false;
    }
    return matchPath(targetDescriptor.path, pathname);
  }

  return false;
}

/**
 * Determines whether a route is excluded by any of the excluded route rules.
 *
 * @param excluded - The list of excluded routes or descriptors.
 * @param pathname - The incoming request pathname.
 * @param method - The HTTP request method.
 * @returns True if the request is excluded.
 */
export function isRouteExcluded(
  excluded: readonly (string | { readonly path: string; readonly method?: RequestMethod })[],
  pathname: string,
  method: string,
): boolean {
  return excluded.some((item) => {
    if (typeof item === "string") {
      return matchPath(item, pathname);
    }
    if (item.method !== undefined && item.method.toUpperCase() !== method.toUpperCase()) {
      return false;
    }
    return matchPath(item.path, pathname);
  });
}
