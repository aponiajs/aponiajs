import type { RequestMethod, RouteContext } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { ElysiaRouteHook } from "./route-compiler.types.ts";

/**
 * The candidate Elysia 2 registration ABI. Kept at the native boundary while
 * the published peer dependency still describes Elysia 1.4.
 *
 * @internal
 */
export type NativeMethodRegistration = (
  this: Elysia,
  method: RequestMethod,
  path: string,
  hook: ElysiaRouteHook,
  handler: (context: RouteContext) => unknown,
) => unknown;
