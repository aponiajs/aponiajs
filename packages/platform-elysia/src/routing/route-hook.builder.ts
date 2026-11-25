import {
  AponiaError,
  applyDeprecationHeaders,
  getDeprecationMetadata,
  getViewOptions,
  getViewTemplate,
  isRouteResponseSchemaMap,
  resolveRouteValidator,
  type CanActivate,
  type ClassToken,
  type Interceptor,
  type RouteContext,
  type RouteResponseSchema,
  type RouteSchema,
  type RouteValidatorInput,
  type ViewRenderOptions,
} from "@aponiajs/common";
import type { AnySchema } from "elysia";
import { httpErrors } from "@aponiajs/platform-core";
import { compileUnrolledGuards, StaticRouteExecutionContext } from "@aponiajs/platform-core";
import type {
  CompiledElysiaRoute,
  ElysiaErrorHook,
  ElysiaRouteAfterHandleContext,
  ElysiaRouteHook,
  RouteViewRenderer,
} from "../interfaces/route-compiler.interface.ts";

/** The lifecycle members of `ElysiaRouteHook` this platform compiles from enhancers. */
type RouteLifecycleHook = Pick<ElysiaRouteHook, "beforeHandle" | "afterHandle">;

/**
 * Builds the hook object one route is registered with: the validators its schema
 * declares, the lifecycle its enhancers run around its handler, and the `error`
 * array it answers a failure through.
 *
 * A route that declares no enhancer mounts the schema hook itself rather than a
 * copy of it, so a controller with no enhancers gains no `beforeHandle`, no
 * `afterHandle`, and no `ExecutionContext` is ever built for one.
 */
/**
 * Prepends the deprecation header writer so it runs before guards and the handler.
 *
 * @internal
 */
export function mergeDeprecationHook(
  hook: ReturnType<typeof toRouteHook>,
  metadata: NonNullable<ReturnType<typeof getDeprecationMetadata>>,
): NonNullable<ReturnType<typeof toRouteHook>> {
  const setHeaders = (context: {
    readonly set: { readonly headers: Record<string, string | number | string[] | undefined> };
  }): void => {
    applyDeprecationHeaders(context.set.headers, metadata);
  };
  const beforeHandle = hook === undefined ? undefined : Reflect.get(hook, "beforeHandle");
  const detail = hook === undefined ? undefined : Reflect.get(hook, "detail");
  return {
    ...hook,
    detail: {
      ...(typeof detail === "object" && detail !== null ? detail : {}),
      deprecated: true,
    },
    beforeHandle:
      beforeHandle === undefined
        ? [setHeaders]
        : Array.isArray(beforeHandle)
          ? [setHeaders, ...beforeHandle]
          : [setHeaders, beforeHandle],
  } as unknown as NonNullable<ReturnType<typeof toRouteHook>>;
}

/**
 * @internal
 */
export function toRouteHook(
  route: CompiledElysiaRoute,
  controller: ClassToken<unknown>,
  handler: (...arguments_: unknown[]) => unknown,
  guards: readonly CanActivate[],
  interceptors: readonly Interceptor[],
  exceptionHooks: ElysiaErrorHook[] | undefined,
  hasCustomFilters = false,
  viewRenderer?: RouteViewRenderer,
): ElysiaRouteHook | undefined {
  const schemaHook = toSchemaHook(route.schema);
  const lifecycleHook = createLifecycleHook(
    route,
    controller,
    handler,
    guards,
    interceptors,
    hasCustomFilters,
    viewRenderer,
  );
  if (lifecycleHook === undefined && exceptionHooks === undefined) {
    return schemaHook;
  }

  const errorHook = exceptionHooks === undefined ? {} : { error: exceptionHooks };

  return { ...schemaHook, ...errorHook, ...lifecycleHook };
}

const defaultForbiddenResponse = Object.freeze({
  type: "about:blank",
  title: "Forbidden",
  status: 403,
  detail: "A guard refused this request.",
  code: "FORBIDDEN",
});

/**
 * The lifecycle members one route runs around its handler, or `undefined` when
 * it runs none.
 *
 * Every enhancer kind is answered for here, and each half for itself: a route
 * mounts a `beforeHandle` when it has a guard or a before half to run, and an
 * `afterHandle` when it has an after half to run. The gate that decided this
 * once tested guards alone, which says the same thing only while nothing else
 * runs — a route carrying an interceptor and no guard would have taken the
 * schema hook on its own and mounted neither half.
 *
 * Guards and before halves share one `beforeHandle` because they run in one
 * order: a route's guards, then its interceptors' before halves, in the order
 * the route declared them. Registering them as two hooks would leave that order
 * to Elysia's registration rather than stating it here.
 *
 * @internal
 */
export function createLifecycleHook(
  route: CompiledElysiaRoute,
  controller: ClassToken<unknown>,
  handler: (...arguments_: unknown[]) => unknown,
  guards: readonly CanActivate[],
  interceptors: readonly Interceptor[],
  hasCustomFilters = false,
  viewRenderer?: RouteViewRenderer,
): RouteLifecycleHook | undefined {
  const hasInterceptBefore = interceptors.some(
    (interceptor) => interceptor.interceptBefore !== undefined,
  );
  const hasResponseMetadata = route.responseHeaders !== undefined || route.httpCode !== undefined;
  const runsBefore =
    guards.length > 0 || hasInterceptBefore || route.sse === true || hasResponseMetadata;
  const runsAfter =
    interceptors.some((interceptor) => interceptor.interceptAfter !== undefined) ||
    route.serializer !== undefined ||
    route.view !== undefined;
  if (!runsBefore && !runsAfter) {
    return undefined;
  }

  // The route a request was handled by never changes, so the value `getRoute`
  // answers with is frozen once here rather than on every call.
  const routeDescription = Object.freeze({ method: route.method, path: route.path });
  // The after halves run over the whole list the route runs, reversed — the
  // application's declaration, the controller's, and the handler's, as one list
  // rather than each scope on its own. Reversing per scope would put the
  // application's interceptor inside a route's, which is the opposite of the
  // order their before halves ran in.
  const afterInterceptors = Object.freeze([...interceptors].reverse());

  const execContext = new StaticRouteExecutionContext(controller, handler, routeDescription);

  const guardHook =
    !hasCustomFilters && guards.length > 0
      ? compileUnrolledGuards(guards, execContext, defaultForbiddenResponse)
      : undefined;

  let beforeHandle: ((context: RouteContext) => unknown) | undefined;
  if (runsBefore) {
    if (
      guardHook !== undefined &&
      !hasInterceptBefore &&
      route.sse !== true &&
      !hasResponseMetadata
    ) {
      beforeHandle = guardHook as (context: RouteContext) => unknown;
    } else {
      beforeHandle = async function (context: RouteContext): Promise<unknown> {
        if (route.responseHeaders !== undefined) {
          for (const [name, value] of Object.entries(route.responseHeaders)) {
            context.set.headers[name] =
              typeof value === "string" || typeof value === "number" ? value : [...value];
          }
        }
        if (route.httpCode !== undefined) {
          context.set.status = route.httpCode;
        }
        if (route.sse === true) {
          context.set.headers["content-type"] = "text/event-stream";
          context.set.headers["cache-control"] = "no-cache";
          context.set.headers["connection"] = "keep-alive";
        }
        if (guardHook !== undefined) {
          const guardResult = guardHook(context);
          if (guardResult !== undefined) {
            const settled = guardResult instanceof Promise ? await guardResult : guardResult;
            if (settled !== undefined) {
              return settled;
            }
          }
        } else if (guards.length > 0) {
          const requestContext = execContext.fork(context);
          for (let i = 0; i < guards.length; i++) {
            const result = guards[i]!.canActivate(requestContext);
            const allowed =
              typeof (result as Promise<boolean>)?.then === "function" ? await result : result;
            if (allowed === false) {
              throw httpErrors.forbidden("A guard refused this request.");
            }
          }
        }

        const interceptorContext = execContext.fork(context);
        for (let i = 0; i < interceptors.length; i++) {
          const interceptor = interceptors[i]!;
          if (interceptor.interceptBefore !== undefined) {
            const res = interceptor.interceptBefore(interceptorContext);
            if (typeof (res as Promise<unknown>)?.then === "function") {
              await res;
            }
          }
        }

        return undefined;
      };
    }
  }

  return {
    ...(runsBefore && beforeHandle ? { beforeHandle } : {}),
    ...(runsAfter
      ? {
          async afterHandle(context: ElysiaRouteAfterHandleContext): Promise<unknown> {
            const requestContext = execContext.fork(context);
            // `undefined` is the one answer that leaves the response as it is,
            // so the value a half answers with is what the next one receives and
            // a half that answers nothing keeps what the response carries.
            // `null`, `false`, and `0` are responses, not absences.
            let response = context.responseValue;
            for (const interceptor of afterInterceptors) {
              const answered = await interceptor.interceptAfter?.(requestContext, response);
              if (answered !== undefined) {
                response = answered;
              }
            }

            if (route.serializer !== undefined) {
              response = await route.serializer(response, context);
            }

            if (route.view !== undefined) {
              if (viewRenderer === undefined) {
                throw new AponiaError(
                  "INVALID_CONFIGURATION",
                  "A route declares @Render() but no view engine is registered.",
                  { template: route.view.template },
                );
              }
              const isHtmx = context.request.headers.get("hx-request") === "true";
              const viewOptions =
                isHtmx && !route.view.options?.fragment
                  ? { ...route.view.options, fragment: true }
                  : route.view.options;
              response = await viewRenderer(route.view.template, response, viewOptions);
              context.set.headers["content-type"] = "text/html; charset=utf-8";
            }

            return response;
          },
        }
      : {}),
  };
}

/**
 * @internal
 */
export function toSchemaHook(schema: RouteSchema | undefined): ElysiaRouteHook | undefined {
  if (!schema) {
    return undefined;
  }

  const hook: ElysiaRouteHook = {
    ...(schema.body ? { body: toElysiaSchema(schema.body) } : {}),
    ...(schema.query ? { query: toElysiaSchema(schema.query) } : {}),
    ...(schema.params ? { params: toElysiaSchema(schema.params) } : {}),
    ...(schema.headers ? { headers: toElysiaSchema(schema.headers) } : {}),
    ...(schema.cookie ? { cookie: toElysiaSchema(schema.cookie) } : {}),
    ...(schema.response ? { response: toElysiaResponseSchema(schema.response) } : {}),
  };

  return Object.keys(hook).length === 0 ? undefined : hook;
}

/**
 * @internal
 */
export function viewMetadata(
  controller: ClassToken<unknown>,
  propertyKey: string | symbol,
): { readonly view?: { readonly template: string; readonly options?: ViewRenderOptions } } {
  const template = getViewTemplate(controller.prototype, propertyKey);
  if (template === undefined) {
    return {};
  }
  const options = getViewOptions(controller.prototype, propertyKey);
  return {
    view: {
      template,
      ...(options === undefined ? {} : { options }),
    },
  };
}

/**
 * Validation models unwrap once during route registration. A Standard Schema
 * validator and a platform-native TypeBox schema both satisfy the neutral
 * `RouteValidator` contract, which Elysia accepts as a schema unchanged, so no
 * branch is needed here.
 *
 * @internal
 */
export function toElysiaSchema(validator: RouteValidatorInput): AnySchema {
  return resolveRouteValidator(validator);
}

/**
 * @internal
 */
export function toElysiaResponseSchema(
  schema: RouteResponseSchema,
): NonNullable<ElysiaRouteHook["response"]> {
  if (!isRouteResponseSchemaMap(schema)) {
    return toElysiaSchema(schema);
  }

  const responses: Record<number, AnySchema> = {};
  for (const [status, validator] of Object.entries(schema)) {
    responses[Number(status)] = toElysiaSchema(validator);
  }
  return responses;
}
