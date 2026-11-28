import type { ResponseSettingsState } from "../interfaces/route-schema.interface.ts";

/** The attributes a written cookie may carry. */
export interface CookieOptions {
  /** The path the browser sends the cookie to. */
  readonly path?: string;
  /** The domain the browser sends the cookie to. */
  readonly domain?: string;
  /** The cookie's lifetime in seconds; a negative value expires it. */
  readonly maxAge?: number;
  /** The absolute expiry the browser applies. */
  readonly expires?: Date;
  /** Whether scripts can read the cookie. */
  readonly httpOnly?: boolean;
  /** Whether the browser sends the cookie over HTTPS only. */
  readonly secure?: boolean;
  /** The cross-site sending policy. */
  readonly sameSite?: "strict" | "lax" | "none";
  /** Whether the cookie is stored in a partitioned jar. */
  readonly partitioned?: boolean;
}

const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Writes one `set-cookie` header into the response settings.
 *
 * The header is an array rather than a joined string, because two cookies are
 * two headers: joining them would make the browser read one malformed cookie.
 * Every platform's response builder appends the array entry by entry.
 *
 * @param set - The response settings the handler or middleware writes through.
 * @param name - The cookie name, a token.
 * @param value - The cookie value, URI-encoded when written.
 * @param options - The attributes to state; omitted ones are not sent.
 * @throws A `TypeError` when the name is not a token or an attribute is invalid.
 */
export function writeCookie(
  set: ResponseSettingsState,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  const serialized = serializeCookie(name, value, options);
  const existing = set.headers["set-cookie"];
  const written =
    existing === undefined ? [] : Array.isArray(existing) ? [...existing] : [String(existing)];

  set.headers["set-cookie"] = [...written, serialized];
}

/**
 * Expires one cookie the browser holds.
 *
 * The value is emptied and the expiry set to the epoch, which is the pair a
 * browser treats as a deletion; the path and domain must match the ones the
 * cookie was written with, so they are the caller's to state.
 *
 * @param set - The response settings the handler or middleware writes through.
 * @param name - The cookie name.
 * @param options - The attributes the original write stated.
 */
export function clearCookie(
  set: ResponseSettingsState,
  name: string,
  options: CookieOptions = {},
): void {
  writeCookie(set, name, "", { ...options, maxAge: 0, expires: new Date(0) });
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!cookieNamePattern.test(name)) {
    throw new TypeError(`Cookie name "${name}" must be an HTTP token.`);
  }

  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`);
  }
  if (options.domain !== undefined) {
    parts.push(`Domain=${options.domain}`);
  }
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  if (options.expires !== undefined) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly === true) {
    parts.push("HttpOnly");
  }
  if (options.secure === true) {
    parts.push("Secure");
  }
  if (options.sameSite !== undefined) {
    const normalized = options.sameSite.toLowerCase();
    if (normalized !== "strict" && normalized !== "lax" && normalized !== "none") {
      throw new TypeError('Cookie sameSite must be "strict", "lax", or "none".');
    }
    parts.push(
      `SameSite=${normalized === "strict" ? "Strict" : normalized === "lax" ? "Lax" : "None"}`,
    );
  }
  if (options.partitioned === true) {
    parts.push("Partitioned");
  }

  return parts.join("; ");
}
