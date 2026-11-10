import type { RouteContext } from "@aponiajs/common";
import { createInertiaResponse } from "./inertia.ts";
import type { InertiaOptions } from "./inertia.types.ts";

/**
 * Creates an Inertia response from a handler that holds the route context.
 *
 * @param component - The front-end component name.
 * @param props - The data the component receives.
 * @param context - The route context that carries the request.
 * @param options - Root document and asset version.
 * @returns The JSON or HTML response.
 */
export function inertia(
  component: string,
  props: Record<string, unknown>,
  context: Pick<RouteContext, "request">,
  options?: InertiaOptions,
): Response {
  return createInertiaResponse(component, props, context.request, options);
}
