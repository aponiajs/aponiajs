import type { DevtoolsHandlers, DevtoolsRequestHandler } from "./devtools-server.types.ts";

/** The path prefix every devtools endpoint lives under. */
export const devtoolsPathPrefix = "/__devtools";

/**
 * Whether a request is one the devtools surface answers itself.
 *
 * The record `/requests` publishes belongs to the application's traffic, and a
 * page that polls it would otherwise be recording itself. The cost of that is
 * one entry per poll, carried into the answer that poll returns, and it lands on
 * a buffer bounded at twice the request window it names: a page polling every
 * second would push the traffic the reader is watching out of the window it is
 * watching it in. The surface is the one client this package can name, so it is
 * the one it leaves out.
 *
 * A URL the platform cannot parse is not the surface's, and the direction is the
 * safe one: the answer decides whether a request is recorded at all, so a
 * spelling this check is not sure of stays recorded rather than dropped.
 *
 * `@internal` — the plugin's arrival hook is the only caller, and this is not
 * part of the endpoint contract the barrel publishes.
 */
export function isDevtoolsSurfaceRequest(request: Request): boolean {
  let pathname: string;

  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return false;
  }

  return pathname === devtoolsPathPrefix || pathname.startsWith(`${devtoolsPathPrefix}/`);
}

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
