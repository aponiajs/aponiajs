import {
  createRequestPipeline,
  notifyRequestError,
  type HttpPolicy,
  type RequestLifecycleHook,
  type ResolvedHttpPolicies,
} from "@aponiajs/common";
import type { AnyElysia } from "elysia";

/** Everything one boot installs on the fetch boundary. @internal */
export interface InstalledHttpPolicies {
  /** The response policies the application stated as boot options. */
  readonly policies?: ResolvedHttpPolicies | undefined;
  /** The neutral policies the graph's packages contributed. */
  readonly pluginPolicies?: readonly HttpPolicy[] | undefined;
  /** The neutral lifecycle hooks the graph's packages contributed. */
  readonly hooks?: readonly RequestLifecycleHook[] | undefined;
}

/**
 * Installs the response policies on Elysia's fetch boundary.
 *
 * A `wrap` covers `handle`, `listen`, and the native instance a boot returns,
 * which is what a policy needs: a response header that appears only through
 * `handle` is absent from a real deployment. Hooks and package policies run
 * before the router so one of them can answer instead — a preflight, a replay,
 * a refusal — and the rest transform the response after it. `onError` rides
 * Elysia's own error hook because a `wrap` sees the answer, not the failure.
 *
 * @param application - The native Elysia application.
 * @param installed - The application's policies and the graph's contributions.
 *
 * @internal
 */
export function installHttpPolicies(
  application: AnyElysia,
  installed: InstalledHttpPolicies,
): void {
  const { policies } = installed;
  const pluginPolicies = installed.pluginPolicies ?? [];
  const hooks = installed.hooks ?? [];
  const pipeline = createRequestPipeline({
    negotiator: undefined,
    policies,
    pluginPolicies,
    hooks,
  });
  if (pipeline === undefined) {
    return;
  }

  const wrapper =
    (fetch: (request: Request, ...rest: unknown[]) => Response | Promise<Response>) =>
    (request: Request, ...rest: unknown[]): Response | Promise<Response> =>
      pipeline(request, (current) => fetch(current, ...rest));

  (
    application as unknown as {
      wrap: (factory: typeof wrapper) => unknown;
    }
  ).wrap(wrapper);

  const observing = hooks.filter((hook) => hook.onError !== undefined);
  if (observing.length > 0) {
    (
      application as unknown as {
        onError: (
          handler: (context: { readonly request: Request; readonly error: unknown }) => unknown,
        ) => unknown;
      }
    ).onError(async ({ request, error }) => {
      await notifyRequestError(observing, request, error);
      return undefined;
    });
  }
}
