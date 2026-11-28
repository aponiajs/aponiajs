import type { RequestPipeline } from "../interfaces/platform-host.interface.ts";
import {
  applyHttpPolicies,
  applyHttpPoliciesSync,
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

  const hasHooks = hooks.length > 0;
  const hasPluginPolicies = pluginPolicies.length > 0;
  const isSyncHeaderOnly =
    !hasHooks &&
    !hasPluginPolicies &&
    policies !== undefined &&
    policies.etag === undefined &&
    policies.compression === undefined;

  if (isSyncHeaderOnly) {
    return (request, next) => {
      const negotiated = negotiator?.(request);
      if (negotiated instanceof Response) {
        return applyHttpPoliciesSync(request, negotiated, policies);
      }
      const effective = negotiated ?? request;
      const preflight = corsPreflight(effective, policies);
      if (preflight !== undefined) {
        return applyHttpPoliciesSync(effective, preflight, policies);
      }
      const result = next(effective);
      if (result instanceof Response) {
        return applyHttpPoliciesSync(effective, result, policies);
      }
      return result.then((response) => applyHttpPoliciesSync(effective, response, policies));
    };
  }

  const onRequestHooks = hooks.filter((h) => h.onRequest !== undefined);
  const onResponseHooks = hooks.filter((h) => h.onResponse !== undefined);
  const onErrorHooks = hooks.filter((h) => h.onError !== undefined);
  const hasOnRequestHooks = onRequestHooks.length > 0;
  const hasOnResponseHooks = onResponseHooks.length > 0;
  const hasOnErrorHooks = onErrorHooks.length > 0;

  const respond = async (request: Request, base: Response): Promise<Response> => {
    const withAppPolicies =
      policies === undefined ? base : await applyHttpPolicies(request, base, policies);
    const withPluginPolicies = hasPluginPolicies
      ? await applyHttpPolicyResponses(pluginPolicies, request, withAppPolicies)
      : withAppPolicies;
    if (hasOnResponseHooks) {
      await notifyRequestResponse(onResponseHooks, request, withPluginPolicies);
    }
    return withPluginPolicies;
  };

  type WrappedPipeline = (
    request: Request,
    next: (request: Request) => Response | Promise<Response>,
  ) => Promise<Response>;

  const coreLifecycle: WrappedPipeline = async (request, next) => {
    if (hasOnRequestHooks) {
      const fromHook = await runRequestHooks(onRequestHooks, request);
      if (fromHook !== undefined) {
        return await respond(request, fromHook);
      }
    }
    if (hasPluginPolicies) {
      const fromPolicy = await runHttpPolicyRequests(pluginPolicies, request);
      if (fromPolicy !== undefined) {
        return await respond(request, fromPolicy);
      }
    }

    const negotiated = negotiator?.(request);
    if (negotiated instanceof Response) {
      return await respond(request, negotiated);
    }
    const effective = negotiated ?? request;
    if (policies !== undefined) {
      const preflight = corsPreflight(effective, policies);
      if (preflight !== undefined) {
        return await respond(effective, preflight);
      }
    }

    let response: Response;
    if (hasOnErrorHooks) {
      try {
        response = await next(effective);
      } catch (error) {
        await notifyRequestError(onErrorHooks, effective, error);
        throw error;
      }
    } else {
      response = await next(effective);
    }
    return await respond(effective, response);
  };

  if (!hooks.some((hook) => hook.wrap !== undefined)) {
    return coreLifecycle;
  }

  return hooks.reduceRight<WrappedPipeline>(
    (inner, hook) =>
      hook.wrap === undefined
        ? inner
        : (current, reqNext) => hook.wrap!(current, (after) => inner(after, reqNext)),
    coreLifecycle,
  );
}
