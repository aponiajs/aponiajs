import {
  AponiaError,
  getDeprecationMetadata,
  getEnhancerMetadata,
  getHttpCode,
  getPipesMetadata,
  getResponseHeaders,
  getRouteMetadata,
  getRouteParameterMetadata,
  getResponseSerializer,
  getVersionMetadata,
  isSseRoute,
  versionPathSegment,
  type ClassToken,
  type EnhancerMetadata,
  type RouteContext,
} from "@aponiajs/common";
import { type Elysia } from "elysia";
import type { MountedRouteEnhancers } from "../controllers/enhancer.resolver.ts";
import { joinPaths, rememberMatchedRoute, type ResolvedPipe } from "@aponiajs/platform-core";
import { isMethodSynchronous } from "./ast-sync-analyzer.ts";
import { registerNativeRoute } from "./native-route.ts";
import {
  isClassConstructor,
  routeExceptionHooks,
  routeGuards,
  routeInterceptors,
} from "./route-enhancer-hooks.ts";
import { createRouteHandler, expectsContextArgument } from "./route-handler-compiler.ts";
import { mergeDeprecationHook, toRouteHook, viewMetadata } from "./route-hook.builder.ts";
import type {
  RouteHandler,
  CompiledElysiaRoute,
  RouteViewRenderer,
} from "../interfaces/route-compiler.interface.ts";

export type { ParameterBinding } from "../interfaces/route-compiler.interface.ts";
export { compileDirectMonomorphicInvoker } from "./route-handler-compiler.ts";

/**
 * Lowers every decorated route into a stable plan shared by child-plugin and
 * direct-root registration.
 *
 * @internal
 */
export function compileElysiaRoutes(
  controller: ClassToken<unknown>,
  controllerPath: string,
): readonly CompiledElysiaRoute[] {
  const controllerEnhancers = getEnhancerMetadata(controller);
  const controllerPipes = getPipesMetadata(controller) ?? [];
  const routes = getRouteMetadata(controller).map((route): CompiledElysiaRoute => {
    const parameters = getRouteParameterMetadata(controller, route.propertyKey);
    const prototypeHandler = Object.getOwnPropertyDescriptor(
      controller.prototype,
      route.propertyKey,
    )?.value as unknown;
    const methodPipes =
      getPipesMetadata(controller.prototype, route.propertyKey) ??
      (typeof prototypeHandler === "function" || typeof prototypeHandler === "object"
        ? (getPipesMetadata(prototypeHandler as object) ?? [])
        : []);
    const routePipes = Object.freeze([...controllerPipes, ...methodPipes]);
    const parameterTypes = Reflect.getMetadata(
      "design:paramtypes",
      controller.prototype,
      route.propertyKey,
    ) as readonly unknown[] | undefined;
    const returnType = Reflect.getMetadata(
      "design:returntype",
      controller.prototype,
      route.propertyKey,
    ) as unknown;
    const declaredParameterCount = parameterTypes?.length;
    const capabilities = parameters.map((parameter) => parameter.kind);
    if (
      parameters.length === 0 &&
      typeof prototypeHandler === "function" &&
      expectsContextArgument(
        prototypeHandler as (...arguments_: unknown[]) => unknown,
        declaredParameterCount,
      )
    ) {
      capabilities.push("context");
    }

    const version =
      getVersionMetadata(controller.prototype, route.propertyKey) ?? getVersionMetadata(controller);
    const responseHeaders = getResponseHeaders(controller, route.propertyKey);
    const httpCode = getHttpCode(controller, route.propertyKey);
    const path =
      typeof version === "string"
        ? joinPaths(versionPathSegment(version), joinPaths(controllerPath, route.path))
        : joinPaths(controllerPath, route.path);

    return Object.freeze({
      method: route.method,
      path,
      propertyKey: route.propertyKey,
      parameters,
      capabilities: Object.freeze([...new Set(capabilities)]),
      schema: route.schema,
      declaredParameterCount,
      declaredParameterTypes: parameterTypes,
      declaredReturnKind: classifyDeclaredReturnKind(returnType, parameterTypes, prototypeHandler),
      pipes: routePipes,
      enhancers: mergeEnhancerMetadata(
        controllerEnhancers,
        getEnhancerMetadata(controller, route.propertyKey),
      ),
      serializer:
        getResponseSerializer(controller.prototype, route.propertyKey) ??
        getResponseSerializer(controller),
      ...(typeof version === "string" ? { version } : {}),
      ...(isSseRoute(controller.prototype, route.propertyKey) || isSseRoute(controller)
        ? { sse: true }
        : {}),
      ...viewMetadata(controller, route.propertyKey),
      ...(responseHeaders === undefined ? {} : { responseHeaders }),
      ...(httpCode === undefined ? {} : { httpCode }),
    });
  });

  return Object.freeze(routes);
}

/**
 * Joins the two scopes a route's enhancers are declared at.
 *
 * `getEnhancerMetadata` reads exactly one scope, so the join belongs here, at
 * the call site: joining inside the reader would double-apply a controller's
 * declarations once this call site also joins them.
 *
 * Each kind is stored in the order that kind runs. Guards and interceptors run
 * outward-in, so the controller's own declarations come first and the handler's
 * follow. Filters run the other way round — most specific first, because the
 * first one that matches answers — so the handler's declarations come first
 * there, and the scope that is left to merge, the application's own, is
 * appended after the whole list by the mount.
 */
function mergeEnhancerMetadata(
  controllerScope: EnhancerMetadata,
  handlerScope: EnhancerMetadata,
): EnhancerMetadata {
  return Object.freeze({
    guards: Object.freeze([...controllerScope.guards, ...handlerScope.guards]),
    interceptors: Object.freeze([...controllerScope.interceptors, ...handlerScope.interceptors]),
    filters: Object.freeze([...handlerScope.filters, ...controllerScope.filters]),
  });
}

function classifyDeclaredReturnKind(
  returnType: unknown,
  parameterTypes?: readonly unknown[],
  prototypeHandler?: unknown,
): CompiledElysiaRoute["declaredReturnKind"] {
  if (returnType === Promise) {
    return "promise";
  }

  // TypeScript emits Object for unknown, object, interfaces, and unions. None
  // of those categories can prove a synchronous return.
  if (returnType === Object) {
    return "unknown";
  }

  if (returnType === undefined) {
    if (
      parameterTypes !== undefined &&
      typeof prototypeHandler === "function" &&
      isMethodSynchronous(prototypeHandler)
    ) {
      return "synchronous";
    }
    return "unknown";
  }

  return "synchronous";
}

/**
 * Registers compiled routes without constructing an intermediate Elysia
 * instance for the controller.
 *
 * Supplied `invokers` replace the platform's own parameter binding for the
 * property keys they cover. Every other route is compiled exactly as it is in
 * their absence, so hand-written descriptors, symbol-keyed handlers, and a
 * controller without an entry keep working.
 *
 * The keys those invokers bound are returned rather than left for a caller to
 * re-derive: which binding serves a route is this function's own decision, taken
 * one route at a time above, and the mount is the only place that knows it. A
 * caller that re-applied the lookup would restate the rule and could disagree
 * with the mount it is describing.
 *
 * `mountedEnhancers` is what a route's hooks are built from while the route
 * registers, never what the compiled route it registers from carries: a compiled
 * plan states what a controller declares and nothing else. The parameter is
 * required, so a mount that merged nothing would have to say so at the call site
 * rather than omit it.
 *
 * @internal
 */
export function registerCompiledElysiaRoutes(
  application: Elysia,
  controller: ClassToken<unknown>,
  instance: unknown,
  routes: readonly CompiledElysiaRoute[],
  mountedEnhancers: MountedRouteEnhancers,
  invokers?: ReadonlyMap<string | symbol, RouteHandler>,
  strictCodegen = false,
  viewRenderer?: RouteViewRenderer,
  globalPipes: readonly ResolvedPipe[] = [],
  instanceResolver?: () => unknown,
  prefix = "",
): ReadonlySet<string | symbol> {
  const generatedKeys = new Set<string | symbol>();

  for (const route of routes) {
    const handler = (instance as Record<PropertyKey, unknown>)[route.propertyKey];
    if (typeof handler !== "function") {
      throw new AponiaError(
        "INVALID_CONTROLLER",
        `Route handler "${String(route.propertyKey)}" is not callable.`,
        { controller: controller.name, handler: String(route.propertyKey) },
      );
    }
    const callableHandler = handler as (...arguments_: unknown[]) => unknown;
    if (isClassConstructor(callableHandler)) {
      throw new AponiaError(
        "INVALID_CONTROLLER",
        `Route handler "${String(route.propertyKey)}" is a class constructor, not a method.`,
        { controller: controller.name, handler: String(route.propertyKey) },
      );
    }

    // `RouteHandler` is declared with a `never` parameter because an
    // invoker is written against its own route's annotations, so an artifact's
    // invoker is widened back to the annotation this platform calls one with.
    // The two are the same function at run time; only the variance differs, and
    // the compiler's own handler needs no widening.
    const rawSuppliedInvoker = invokers?.get(route.propertyKey);
    const suppliedInvoker =
      typeof rawSuppliedInvoker === "function" &&
      !/^class[\s{/]/.test(Function.prototype.toString.call(rawSuppliedInvoker).trimStart())
        ? rawSuppliedInvoker
        : undefined;
    if (suppliedInvoker !== undefined) {
      generatedKeys.add(route.propertyKey);
    } else if (strictCodegen) {
      throw new AponiaError(
        "UNSAFE_CODE_GENERATION",
        `Route "${route.method} ${route.path}" has no generated invoker and strict code generation is enabled.`,
        {
          controller: controller.name,
          handler: String(route.propertyKey),
          method: route.method,
          path: route.path,
        },
      );
    }
    const mountPath = prefix === "" ? route.path : joinPaths(prefix, route.path);
    const hasCustomFilters =
      mountedEnhancers.controller.forRoute(route.enhancers).filters.length > 0 ||
      mountedEnhancers.global.filters.length > 0;
    const deprecation =
      getDeprecationMetadata(controller.prototype, route.propertyKey) ??
      getDeprecationMetadata(controller);
    const hook = toRouteHook(
      route,
      controller,
      callableHandler,
      routeGuards(mountedEnhancers, route),
      routeInterceptors(mountedEnhancers, route),
      routeExceptionHooks(mountedEnhancers, route),
      hasCustomFilters,
      viewRenderer,
    );
    // The route a request matched is not on the request after routing, and a
    // response observer at the boundary cannot recover it from the raw path.
    // Recorded here, where the template is known, so a metrics or tracing hook
    // reads `/users/:id` rather than one series per id.
    const recordedHook = withRouteMemory(hook, mountPath);
    registerNativeRoute(
      application,
      route.method,
      mountPath,
      suppliedInvoker === undefined
        ? createRouteHandler(callableHandler, instance, route, globalPipes, instanceResolver)
        : (suppliedInvoker as (context: RouteContext) => unknown),
      deprecation === undefined ? recordedHook : mergeDeprecationHook(recordedHook, deprecation),
    );
  }

  return generatedKeys;
}

function withRouteMemory(
  hook: ReturnType<typeof toRouteHook>,
  mountPath: string,
): NonNullable<ReturnType<typeof toRouteHook>> {
  const record = (context: { readonly request: Request }): void => {
    rememberMatchedRoute(context.request, mountPath);
  };
  return (
    hook === undefined ? { transform: record } : { ...hook, transform: record }
  ) as NonNullable<ReturnType<typeof toRouteHook>>;
}

/**
 * @internal
 */
export { joinPaths };
