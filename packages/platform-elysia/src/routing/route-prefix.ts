import { AponiaError } from "@aponiajs/common";

/**
 * Normalizes the application's route prefix.
 *
 * `undefined`, `""`, and `"/"` mean no prefix. A prefix that does not begin
 * with `/` is refused, and trailing slashes are removed so joining a route path
 * never produces a double slash.
 *
 * @param prefix - The declared prefix.
 * @returns The normalized prefix, or `""` for none.
 * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE`.
 *
 * @internal
 */
export function normalizeRoutePrefix(prefix: string | undefined): string {
  if (prefix === undefined) {
    return "";
  }

  if (typeof prefix !== "string") {
    throw new AponiaError("INVALID_CONFIGURATION_VALUE", "The route prefix is not a string.", {
      issues: Object.freeze(['"prefix" must be a string']),
    });
  }

  const trimmed = prefix.trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }

  if (!trimmed.startsWith("/")) {
    throw new AponiaError("INVALID_CONFIGURATION_VALUE", 'The route prefix must begin with "/".', {
      issues: Object.freeze(['"prefix" must begin with "/"']),
    });
  }

  return trimmed.replace(/\/+$/, "");
}

/**
 * Returns the path below a prefix, or `undefined` when the path is outside it.
 *
 * A request that does not carry the prefix names no route the application
 * mounted, so version negotiation and middleware matching leave it alone.
 *
 * @param pathname - The request pathname.
 * @param prefix - The normalized prefix, or `""` for none.
 * @returns The unprefixed path, or `undefined`.
 *
 * @internal
 */
export function stripRoutePrefix(pathname: string, prefix: string): string | undefined {
  if (prefix === "") {
    return pathname;
  }
  if (pathname === prefix) {
    return "/";
  }
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length);
  }
  return undefined;
}
