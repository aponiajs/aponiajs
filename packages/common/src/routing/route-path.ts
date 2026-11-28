/**
 * Joins one path segment onto another, keeping exactly one leading slash.
 *
 * @param controllerPath - The prefix, with or without a leading or trailing slash.
 * @param routePath - The segment to join under it.
 * @returns The joined path, or `/` when both are empty.
 */
export function joinPaths(controllerPath: string, routePath: string): string {
  const segments = [controllerPath, routePath]
    .map((path) => trimSlashes(path.trim()))
    .filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 47) {
    start += 1;
  }
  while (end > start && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}
