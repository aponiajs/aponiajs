import type { MountedRoute } from "../interfaces/kernel.interface.ts";

/**
 * Orders mounts so a runtime whose router resolves first-match sees literals first.
 *
 * @internal
 */
export function compareRouteSpecificity(left: MountedRoute, right: MountedRoute): number {
  return routeSpecificity(right.route.path) - routeSpecificity(left.route.path);
}

function routeSpecificity(path: string): number {
  let specificity = 0;
  for (const segment of path.split("/").slice(1)) {
    if (segment === "*") {
      continue;
    }
    if (segment.startsWith(":")) {
      specificity += segment.endsWith("?") ? 1 : 2;
      continue;
    }
    specificity += 4;
  }
  return specificity;
}
