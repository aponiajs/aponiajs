import { AponiaError, type RequestMethod, type RouteContext } from "@aponiajs/common";
import type { Elysia, InputSchema } from "elysia";

/**
 * The only place this platform calls Elysia's route registration API.
 *
 * Elysia 2 removes `route(method, path, handler, hook)` in favour of
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
  hook: InputSchema<never> | undefined,
): void {
  const nativeRoute = (application as unknown as { readonly route?: unknown }).route;
  if (typeof nativeRoute !== "function") {
    throw new AponiaError(
      "UNSUPPORTED_ELYSIA_VERSION",
      `The installed Elysia does not expose route(), so "${method} ${path}" cannot be mounted. ` +
        "AponiaJS supports Elysia 1.4.x, where routes are registered with route(method, path, handler, hook). " +
        "Elysia 2 replaced it with method(method, path, hook, handler) and is not supported yet.",
      Object.freeze({ method, path, supported: "1.4.x" }),
    );
  }

  application.route(method, path, handler, hook);
}
