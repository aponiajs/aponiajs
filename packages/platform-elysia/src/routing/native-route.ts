import { AponiaError, type RequestMethod, type RouteContext } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { ElysiaRouteHook } from "./route-compiler.types.ts";

/**
 * The only place this platform calls Elysia's route registration API.
 *
 * Elysia 2 registers routes with `route(method, path, hook, handler)`, so a
 * version that moves the API lands here instead of across the route compiler.
 * See `docs/elysia-compatibility.md`.
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
  const nativeRoute = (application as unknown as { readonly route?: unknown }).route;
  if (typeof nativeRoute !== "function") {
    throw new AponiaError(
      "UNSUPPORTED_ELYSIA_VERSION",
      `The installed Elysia does not expose route(), so "${method} ${path}" cannot be mounted. ` +
        "AponiaJS supports Elysia 2.0.x, where routes are registered with route(method, path, hook, handler).",
      Object.freeze({ method, path, supported: "2.0.x" }),
    );
  }

  // Elysia's `HTTPMethod` type accepts "ALL" but its router answers 404 for it:
  // the runtime spelling of an all-methods route is `all()`. This module is the
  // one place the platform calls that API, so the mapping stays here.
  if (method === "ALL") {
    const nativeAll = (application as unknown as { readonly all?: unknown }).all;
    if (typeof nativeAll !== "function") {
      throw new AponiaError(
        "UNSUPPORTED_ELYSIA_VERSION",
        `The installed Elysia does not expose all(), so "ALL ${path}" cannot be mounted.`,
        Object.freeze({ method, path, supported: "2.0.x" }),
      );
    }

    const registerAll = nativeAll as (
      path: string,
      hookOrHandler: ElysiaRouteHook | ((context: RouteContext) => unknown),
      handler?: (context: RouteContext) => unknown,
    ) => unknown;
    if (hook === undefined) {
      registerAll.call(application, path, handler);
      return;
    }
    registerAll.call(application, path, hook, handler);
    return;
  }

  // `method` is among Elysia's most heavily overloaded signatures: each overload
  // infers a route's whole schema from the hook it is handed. The hook this
  // platform compiles states those fields under its own contract instead, so the
  // call states the signature it needs rather than letting inference pick an
  // overload that hook cannot satisfy. This module is that cast's boundary —
  // it is the only place the platform calls the native route API.
  const nativeApplication = application as unknown as {
    readonly route: (
      method: RequestMethod,
      path: string,
      hook: ElysiaRouteHook | undefined,
      handler: (context: RouteContext) => unknown,
      ...rest: readonly unknown[]
    ) => unknown;
  };

  if (hook === undefined) {
    (
      application as unknown as {
        readonly route: (
          method: RequestMethod,
          path: string,
          handler: (context: RouteContext) => unknown,
        ) => unknown;
      }
    ).route(method, path, handler);
    return;
  }
  nativeApplication.route(method, path, hook, handler);
}
