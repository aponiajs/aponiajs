/**
 * Joins one path segment onto another, keeping exactly one leading slash.
 *
 * @param controllerPath - The prefix, with or without a leading or trailing slash.
 * @param routePath - The segment to join under it.
 * @returns The joined path, or `/` when both are empty.
 */
export function joinPaths(controllerPath: string, routePath: string): string {
  const segments = [controllerPath, routePath]
    .map((path) => path.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
