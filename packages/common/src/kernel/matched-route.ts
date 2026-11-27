const matchedRoutes = new WeakMap<Request, string>();

/**
 * Records the route template one request matched.
 *
 * A response policy runs at the response boundary, after routing, where the
 * matched route is no longer on the request. The kernel records it once while
 * it dispatches, and an observer reads the template rather than re-deriving it
 * from the raw path — which is what keeps a metric label at `/users/:id`
 * instead of one series per id.
 *
 * @param request - The request the kernel dispatched.
 * @param route - The matched route template.
 */
export function rememberMatchedRoute(request: Request, route: string): void {
  matchedRoutes.set(request, route);
}

/**
 * Reads the route template one request matched.
 *
 * @param request - The request an observer is looking at.
 * @returns The template, or `undefined` for a request no route matched.
 */
export function matchedRouteOf(request: Request): string | undefined {
  return matchedRoutes.get(request);
}
