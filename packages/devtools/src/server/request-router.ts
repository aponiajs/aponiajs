import type { DevtoolsHandlers, DevtoolsRequestHandler } from "./devtools-server.types.ts";

/** The path prefix every devtools endpoint lives under. */
export const devtoolsPathPrefix = "/__devtools";

/**
 * Routes one request to the handler that owns its path.
 *
 * Pure, and deliberately so: a method and a path are the whole contract a
 * caller can observe from outside, and deciding them without a socket is what
 * makes `405` and `404` testable without one.
 *
 * The order of the two decisions is part of that contract. The method is
 * settled before any path is read, so a `POST` to a path this server does not
 * own is a `405` rather than a `404` — the request never reached the point where
 * a path could matter — and the answer says which method is served.
 *
 * The lookup is `Object.hasOwn`, because the suffix comes from the request: a
 * plain read of the record would find `/constructor` on `Object.prototype` and
 * call it. An unclaimed suffix, the bare prefix, and a trailing slash the record
 * does not carry are all `404`: the record states the paths this server serves
 * and the dispatcher does not guess at the rest.
 */
export function routeRequest(
  request: Request,
  handlers: DevtoolsHandlers,
): Response | Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET" } });
  }

  const { pathname } = new URL(request.url);
  const suffix = pathname.startsWith(devtoolsPathPrefix)
    ? pathname.slice(devtoolsPathPrefix.length)
    : undefined;
  const handler: DevtoolsRequestHandler | undefined =
    suffix !== undefined && Object.hasOwn(handlers, suffix) ? handlers[suffix] : undefined;

  if (handler === undefined) {
    return new Response(null, { status: 404 });
  }

  return handler(request);
}
