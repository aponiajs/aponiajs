import type { RequestPipeline } from "../interfaces/platform-host.interface.ts";
import {
  applyHttpPolicies,
  applyHttpPolicyResponses,
  corsPreflight,
  runHttpPolicyRequests,
  type HttpPolicy,
} from "../policy/http.policy.ts";
import type { ResolvedHttpPolicies } from "../interfaces/http-policy.interface.ts";
import {
  notifyRequestError,
  notifyRequestResponse,
  runRequestHooks,
  type RequestLifecycleHook,
} from "../kernel/request-hooks.ts";
import type { VersionNegotiator } from "../interfaces/version-negotiation.interface.ts";

/** What one boot compiles into the request pipeline. @internal */
export interface RequestPipelineOptions {
  /** Header and media-type version negotiation. */
  readonly negotiator?: VersionNegotiator | undefined;
  /** The response policies the application declared as boot options. */
  readonly policies?: ResolvedHttpPolicies | undefined;
  /** The neutral policies the graph's packages contributed. */
  readonly pluginPolicies?: readonly HttpPolicy[] | undefined;
  /** The neutral request lifecycle hooks the graph's packages contributed. */
  readonly hooks?: readonly RequestLifecycleHook[] | undefined;
}

/**
 * Compiles one request pipeline, once at boot.
 *
 * Order is the contract: a request hook may short-circuit before anything
 * else, then a package policy may answer before routing (a preflight, a
 * replay), then version negotiation, then the application's own preflight,
 * then the runtime's dispatch. Every answer — including a short-circuit — runs
 * the response policies in the same order, then the hooks observe the final
 * response.
 *
 * @internal
 */
export function createRequestPipeline(
  options: RequestPipelineOptions,
): RequestPipeline | undefined {
  const { negotiator, policies } = options;
  const pluginPolicies = options.pluginPolicies ?? [];
  const hooks = options.hooks ?? [];
  if (
    negotiator === undefined &&
    policies === undefined &&
    pluginPolicies.length === 0 &&
    hooks.length === 0
  ) {
    return undefined;
  }

  const lifecycle = async (
    request: Request,
    next: (request: Request) => Response | Promise<Response>,
  ): Promise<Response> => {
    const respond = async (base: Response): Promise<Response> => {
      const withAppPolicies =
        policies === undefined ? base : await applyHttpPolicies(request, base, policies);
      const withPluginPolicies = await applyHttpPolicyResponses(
        pluginPolicies,
        request,
        withAppPolicies,
      );
      await notifyRequestResponse(hooks, request, withPluginPolicies);
      return withPluginPolicies;
    };

    const fromHook = await runRequestHooks(hooks, request);
    if (fromHook !== undefined) {
      return await respond(fromHook);
    }
    const fromPolicy = await runHttpPolicyRequests(pluginPolicies, request);
    if (fromPolicy !== undefined) {
      return await respond(fromPolicy);
    }

    const negotiated = negotiator?.(request);
    if (negotiated instanceof Response) {
      return await respond(negotiated);
    }
    const effective = negotiated ?? request;
    if (policies !== undefined) {
      const preflight = corsPreflight(effective, policies);
      if (preflight !== undefined) {
        return await respond(preflight);
      }
    }

    const response = await Promise.resolve(next(effective)).catch(async (error: unknown) => {
      await notifyRequestError(hooks, effective, error);
      throw error;
    });
    return await respond(response);
  };

  return async (request, next) => {
    // Wraps are composed outermost-first so the first registered hook is the
    // widest scope, and every short-circuit inside `lifecycle` still runs them.
    const wrapped = hooks.reduceRight<(request: Request) => Promise<Response>>(
      (inner, hook) => (hook.wrap === undefined ? inner : (current) => hook.wrap!(current, inner)),
      (current) => lifecycle(current, next),
    );
    return await wrapped(request);
  };
}
