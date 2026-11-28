/**
 * Bitmask of request context capabilities required by a compiled route.
 */
export const RouteContextMask = Object.freeze({
  NONE: 0,
  PARAMS: 1 << 0,
  QUERY: 1 << 1,
  HEADERS: 1 << 2,
  COOKIE: 1 << 3,
  BODY: 1 << 4,
  IP: 1 << 5,
  HOST: 1 << 6,
  STORE: 1 << 7,
  SET_STATUS: 1 << 8,
  /** Requires full context (`@Context()`, `@Req()`, custom params, or interceptors/filters). */
  FULL_CONTEXT: 1 << 9,
});
