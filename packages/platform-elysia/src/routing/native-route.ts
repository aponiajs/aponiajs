import { AponiaError, type RequestMethod, type RouteContext } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { NativeMethodRegistration } from "./native-route.types.ts";
import type { ElysiaRouteHook } from "./route-compiler.types.ts";

/**
 * The only place this platform calls Elysia's route registration API.
 *
 * Keep the supported 1.4 path unchanged while preparing the Elysia 2 ABI,
 * which moves the hook before the handler. Capability detection here is not
 * a declaration of full Elysia 2 support: types, plugins, and the other native
 * boundaries still need migration before the peer dependency can be changed.
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
    application.route(method, path, handler, hook);
    return;
  }

  const nativeMethod = (application as unknown as { readonly method?: unknown }).method;
  if (typeof nativeMethod === "function") {
    // The current 1.4 declarations cannot describe the candidate 2.x method.
    // Restore its ABI only here, after checking that it is callable. Preserve
    // both the native receiver and the original hook/handler objects.
    (nativeMethod as NativeMethodRegistration).call(application, method, path, hook ?? {}, handler);
    return;
  }

  throw new AponiaError(
    "UNSUPPORTED_ELYSIA_VERSION",
    `The installed Elysia exposes neither route() nor method(), so "${method} ${path}" cannot be mounted. ` +
      "AponiaJS currently supports Elysia 1.4.x. The Elysia 2 migration is not complete.",
    Object.freeze({ method, path, supported: "1.4.x" }),
  );
}
