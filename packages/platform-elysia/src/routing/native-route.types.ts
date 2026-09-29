import type { RequestMethod, RouteContext } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { ElysiaRouteHook } from "./route-compiler.types.ts";

/**
 * The Elysia 2 registration ABI at the native boundary.
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
