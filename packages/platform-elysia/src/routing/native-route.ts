import { AponiaError, type RequestMethod, type RouteContext } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { ElysiaRouteHook } from "./route-compiler.types.ts";

/**
 * The only place this platform calls Elysia's route registration API.
 *
 * Elysia 2 removed `route(method, path, handler, hook)` in favour of
 * `method(method, path, hook, handler)`, which also swaps the last two
 * arguments, so a major version lands here instead of across the route
 * compiler. See `docs/elysia-compatibility.md`.
 *
 * The guard exists because a mismatched pair otherwise fails as a bare
 * `TypeError` from inside a compiled dependency, which names neither AponiaJS
 * nor the version that moved the API.
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
  const nativeMethod = (application as unknown as { readonly method?: unknown }).method;
  if (typeof nativeMethod !== "function") {
    throw new AponiaError(
      "UNSUPPORTED_ELYSIA_VERSION",
      `The installed Elysia does not expose method(), so "${method} ${path}" cannot be mounted. ` +
        "AponiaJS supports Elysia 2.0.x, where routes are registered with method(method, path, hook, handler). " +
        "Elysia 1.4 registers them with route(method, path, handler, hook) and is no longer supported.",
      Object.freeze({ method, path, supported: "2.0.x" }),
    );
  }

  // `method` is among Elysia's most heavily overloaded signatures: each overload
  // infers a route's whole schema from the hook it is handed. The hook this
  // platform compiles states those fields under its own contract instead, so the
  // call states the signature it needs rather than letting inference pick an
  // overload that hook cannot satisfy. This module is that cast's boundary —
  // it is the only place the platform calls the native route API.
  const nativeApplication = application as unknown as {
    readonly method: (
      method: RequestMethod,
      path: string,
      hook: ElysiaRouteHook | undefined,
      handler: (context: RouteContext) => unknown,
    ) => unknown;
  };

  nativeApplication.method(method, path, hook, handler);
}
