import type { RouteContext } from "@aponiajs/common";
import { createInertiaResponse } from "./inertia.ts";
import type { InertiaOptions } from "./inertia.types.ts";

/**
 * Creates an Inertia response with type-safe props.
 *
 * Can be returned directly from route handlers:
 * ```ts
 * @Get()
 * index(@Context() ctx: RouteContext) {
 *   return inertia("Users/Index", { users }, ctx);
 * }
 * ```
 *
 * @param component - The front-end component name or co-located page component.
 * @param props - The data the component receives.
 * @param context - Optional route context carrying the incoming request.
 * @param options - Root document and asset version.
 * @returns The JSON or HTML response.
 */
export function inertia<TProps extends Record<string, unknown> = Record<string, unknown>>(
  component: string,
  props?: TProps,
  context?: Pick<RouteContext, "request">,
  options?: InertiaOptions,
): Response {
  const request = context?.request ?? new Request("http://localhost/");
  return createInertiaResponse(component, props ?? {}, request, options);
}
