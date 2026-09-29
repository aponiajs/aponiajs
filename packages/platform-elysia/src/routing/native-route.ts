import { AponiaError, type RequestMethod, type RouteContext } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { NativeMethodRegistration } from "./native-route.types.ts";
import type { ElysiaRouteHook } from "./route-compiler.types.ts";

/**
 * The only place this platform calls Elysia's route registration API.
 *
 * Elysia 2 registers the hook before the handler. The legacy branch remains
 * for applications that expose a 1.x-compatible native route method.
 *
 * @internal
 */
export function registerNativeRoute(
  application: Elysia,
  method: RequestMethod,
  path: string,
  handler: (context: RouteContext) => unknown,
  hook: ElysiaRouteHook | undefined,
): void {
  const nativeRoute = (application as unknown as { readonly route?: unknown }).route;
  if (typeof nativeRoute === "function") {
    (
      nativeRoute as (
        this: Elysia,
        method: RequestMethod,
        path: string,
        handler: (context: RouteContext) => unknown,
        hook: ElysiaRouteHook | undefined,
      ) => unknown
    ).call(application, method, path, handler, hook);
    return;
  }

  const nativeMethod = (application as unknown as { readonly method?: unknown }).method;
  if (typeof nativeMethod === "function") {
    // Preserve the native receiver and the original hook/handler objects.
    (nativeMethod as NativeMethodRegistration).call(application, method, path, hook ?? {}, handler);
    return;
  }

  throw new AponiaError(
    "UNSUPPORTED_ELYSIA_VERSION",
    `The installed Elysia exposes neither route() nor method(), so "${method} ${path}" cannot be mounted.`,
    Object.freeze({ method, path, supported: "2.0.0-beta.19" }),
  );
}
