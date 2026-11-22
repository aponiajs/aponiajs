import {
  applyHttpPolicies,
  corsPreflight,
  type ResolvedHttpPolicies,
} from "@aponiajs/platform-core";
import type { AnyElysia } from "elysia";

/**
 * Installs the response policies on Elysia's fetch boundary.
 *
 * A `wrap` covers `handle`, `listen`, and the native instance a boot returns,
 * which is what a policy needs: a response header that appears only through
 * `handle` is absent from a real deployment. Preflight is answered before the
 * router; every other response is transformed after it.
 *
 * @param application - The native Elysia application.
 * @param policies - The resolved policies, or `undefined` for none.
 *
 * @internal
 */
export function installHttpPolicies(
  application: AnyElysia,
  policies: ResolvedHttpPolicies | undefined,
): void {
  if (policies === undefined) {
    return;
  }

  const wrapper =
    (fetch: (request: Request, ...rest: unknown[]) => Response | Promise<Response>) =>
    async (request: Request, ...rest: unknown[]): Promise<Response> => {
      const preflight = corsPreflight(request, policies);
      if (preflight !== undefined) {
        return preflight;
      }
      const response = await fetch(request, ...rest);
      return await applyHttpPolicies(request, response, policies);
    };

  (
    application as unknown as {
      wrap: (factory: typeof wrapper) => unknown;
    }
  ).wrap(wrapper);
}
