import {
  AponiaError,
  getEnhancerMetadata,
  getPipesMetadata,
  getRouteMetadata,
  getRouteParameterMetadata,
  isRouteResponseSchemaMap,
  resolveRouteValidator,
  type ArgumentMetadata,
  type ArgumentType,
  type CustomParamFactory,
  type Interceptor,
  type ArgumentsHost,
  type CanActivate,
  type ClassToken,
  type EnhancerMetadata,
  type HttpArgumentsHost,
  type LoggerService,
  type RouteContext,
  type RouteParameterKind,
  type RouteParameterMetadata,
  type RouteResponseSchema,
  type RouteSchema,
  type RouteValidatorInput,
} from "@aponiajs/common";
import { type AnySchema, type Elysia } from "elysia";
import type { MountedRouteEnhancers, ResolvedFilter } from "../controllers/enhancer-resolver.ts";
import { isFilterMatch, reportThroughLogger } from "../errors/default-exception-filter.ts";
import { httpErrors } from "../errors/http-error.ts";
import { compileUnrolledGuards } from "../enhancers/enhancer-pipeline.ts";
import { StaticRouteExecutionContext } from "../enhancers/static-execution-context.ts";
import { executePipes, resolvePipe, type ResolvedPipe } from "../pipes/pipe-resolver.ts";
import { isMethodSynchronous } from "./ast-sync-analyzer.ts";
import { registerNativeRoute } from "./native-route.ts";
import type {
  RouteHandler,
  CompiledElysiaRoute,
  ElysiaErrorHook,
  ElysiaRouteAfterHandleContext,
  ElysiaRouteHook,
  ParameterBinding,
} from "./route-compiler.types.ts";

export type { ParameterBinding } from "./route-compiler.types.ts";

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

    return Object.freeze({
      method: route.method,
      path: joinPaths(controllerPath, route.path),
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
    }
    const hasCustomFilters =
      mountedEnhancers.controller.forRoute(route.enhancers).filters.length > 0 ||
      mountedEnhancers.global.filters.length > 0;
    registerNativeRoute(
      application,
      route.method,
      route.path,
      suppliedInvoker === undefined
        ? createRouteHandler(callableHandler, instance, route)
        : (suppliedInvoker as (context: RouteContext) => unknown),
      toRouteHook(
        route,
        controller,
        callableHandler,
        routeGuards(mountedEnhancers, route),
        routeInterceptors(mountedEnhancers, route),
        routeExceptionHooks(mountedEnhancers, route),
        hasCustomFilters,
      ),
    );
  }

  return generatedKeys;
}

/**
 * The guards one route runs: the application's own declaration first, then the
 * ones the route declares, each scope in the order it declared them.
 *
 * A route that declares no guard of its own runs the application's declaration
 * itself, so a route with no enhancers at all merges nothing and allocates
 * nothing.
 */
function routeGuards(
  mountedEnhancers: MountedRouteEnhancers,
  route: CompiledElysiaRoute,
): readonly CanActivate[] {
  const declared = mountedEnhancers.controller.forRoute(route.enhancers).guards;
  if (declared.length === 0) {
    return mountedEnhancers.global.guards;
  }

  return Object.freeze([...mountedEnhancers.global.guards, ...declared]);
}

/**
 * The interceptors one route runs, in the order their before halves run: the
 * application's own declaration first, then the ones the route declares, each
 * scope in the order it declared them.
 *
 * A route that declares no interceptor of its own runs the application's
 * declaration itself, so a route that declares no interceptor at all merges
 * nothing and allocates nothing.
 */
function routeInterceptors(
  mountedEnhancers: MountedRouteEnhancers,
  route: CompiledElysiaRoute,
): readonly Interceptor[] {
  const declared = mountedEnhancers.controller.forRoute(route.enhancers).interceptors;
  if (declared.length === 0) {
    return mountedEnhancers.global.interceptors;
  }

  return Object.freeze([...mountedEnhancers.global.interceptors, ...declared]);
}

/**
 * The `error` array one route mounts: the filters the route declares, then the
 * application's own, then the Problem Details mapping every route carries last.
 *
 * The order is the reverse of the guard order, because the first filter that
 * answers wins: a route's own filters are consulted before the application's,
 * so the most specific one decides, and the mapping at the end answers only
 * what every declared filter declined.
 *
 * `undefined` is what a mount with no boot states, and it is returned as such:
 * a mount that resolved nothing and has nothing to map with mounts no `error`
 * hook at all rather than an inert one.
 */
function routeExceptionHooks(
  mountedEnhancers: MountedRouteEnhancers,
  route: CompiledElysiaRoute,
): ElysiaErrorHook[] | undefined {
  const { defaultFilter, logger } = mountedEnhancers.exceptionHandling;
  const declared = mountedEnhancers.controller.forRoute(route.enhancers).filters;
  const filters = [...declared, ...mountedEnhancers.global.filters];
  if (filters.length === 0 && defaultFilter === undefined) {
    return undefined;
  }

  const hooks = filters.map((filter) => createFilterHook(filter, logger));
  if (defaultFilter !== undefined) {
    hooks.push(defaultFilter);
  }

  return hooks;
}

/**
 * One declared filter as a route's `error` array runs it.
 *
 * The wrapper is what makes a filter's own failure reach the entry behind it
 * rather than escape into a second failure: the exception is matched against
 * the types the filter declared, `catch` is called with the matched exception
 * and the host, its result is awaited, and a filter that throws or rejects is
 * reported on the system logger and declined. Reporting it keeps a broken
 * filter visible, and declining it is what lets the mapping the route carries
 * last still answer the request.
 *
 * Declining happens before the filter is called, so a filter that answers for a
 * narrower type than the one thrown is never constructed-for and never runs.
 */
function createFilterHook(
  filter: ResolvedFilter,
  logger: LoggerService | undefined,
): ElysiaErrorHook {
  return async (context) => {
    if (!isFilterMatch(filter, context.error)) {
      return undefined;
    }

    try {
      const answered = await filter.instance.catch(context.error, createArgumentsHost(context));
      // The documented contract is that `undefined` and `null` both decline, so
      // the next entry in the array answers. Elysia 1.4 read the two the same
      // way; Elysia 2 ends the error path on anything that is not `undefined`,
      // so a filter declining with `null` is translated rather than allowed to
      // answer an empty response in the mapping's place.
      return answered === null ? undefined : answered;
    } catch (failure) {
      reportThroughLogger(logger, failure, "ExceptionsHandler");
      return undefined;
    }
  };
}

/**
 * What a filter running for one request is given about the route it runs for.
 *
 * The object is built per request because it carries the request's own context,
 * and it is an `ArgumentsHost` rather than an `ExecutionContext`: a filter is
 * not asked which class or handler threw, and `common` deliberately does not
 * carry the per-transport dispatch Nest's host performs.
 */
function createArgumentsHost(context: RouteContext): ArgumentsHost {
  const httpHost: HttpArgumentsHost = Object.freeze({ getRequest: () => context });

  return Object.freeze({
    getContext: () => context,
    switchToHttp: () => httpHost,
    getType: () => "http" as const,
  });
}

/**
 * Class constructors pass a `typeof` check and then throw when called without
 * `new`, which would surface as a raw engine message on every request. The
 * class definition's own source is the reliable signal: a class is only ever
 * written as `class ...`, and minifiers keep that leading keyword.
 */
function isClassConstructor(handler: (...arguments_: unknown[]) => unknown): boolean {
  return /^class[\s{/]/.test(Function.prototype.toString.call(handler).trimStart());
}

function hasRouteOrParameterPipes(route: CompiledElysiaRoute): boolean {
  if (route.pipes !== undefined && route.pipes.length > 0) {
    return true;
  }
  return route.parameters.some(
    (parameter) => parameter.pipes !== undefined && parameter.pipes.length > 0,
  );
}

function hasCustomParameters(route: CompiledElysiaRoute): boolean {
  return route.parameters.some((parameter) => parameter.kind === "custom");
}

function isPipedParameterKind(kind: RouteParameterKind): boolean {
  return (
    kind === "body" ||
    kind === "query" ||
    kind === "params" ||
    kind === "headers" ||
    kind === "cookie"
  );
}

interface ParameterExecutionPlan {
  readonly index: number;
  readonly kind: RouteParameterKind;
  readonly property?: string;
  readonly factory?: CustomParamFactory<unknown, unknown>;
  readonly data?: unknown;
  readonly pipes: readonly ResolvedPipe[];
  readonly metadata: ArgumentMetadata;
}

function extractContextSourceValue(context: RouteContext, kind: RouteParameterKind): unknown {
  switch (kind) {
    case "context":
      return context;
    case "set":
      return context.set;
    case "request":
      return context.request;
    case "body":
      return context.body;
    case "query":
      return context.query;
    case "params":
      return context.params;
    case "headers":
      return context.headers;
    case "cookie":
      return context.cookie;
    default:
      return (context as unknown as Record<string, unknown>)[kind];
  }
}

function extractParameterValue(
  context: RouteContext,
  kind: RouteParameterKind,
  property?: string,
  factory?: CustomParamFactory<unknown, unknown>,
  data?: unknown,
): unknown {
  if (kind === "custom") {
    return factory !== undefined ? factory(data, context) : undefined;
  }

  const source = extractContextSourceValue(context, kind);
  if (property === undefined) {
    return source;
  }
  if (typeof source === "object" && source !== null) {
    const val = (source as Record<string, unknown>)[property];
    if (kind === "cookie") {
      return (val as { value?: unknown } | undefined)?.value;
    }
    return val;
  }
  return undefined;
}

/**
 * Compiles parameter metadata once during bootstrap so request dispatch neither
 * allocates an argument array nor hides precise context usage from Elysia's
 * static handler analysis.
 */
function createRouteHandler(
  handler: (...arguments_: unknown[]) => unknown,
  instance: unknown,
  route: CompiledElysiaRoute,
): (context: RouteContext) => unknown {
  if (
    (hasRouteOrParameterPipes(route) || hasCustomParameters(route)) &&
    route.parameters.length > 0
  ) {
    const argumentCount = (route.parameters.at(-1)?.index ?? -1) + 1;
    const parameterPlans = Object.freeze(
      route.parameters.map((param): ParameterExecutionPlan => {
        const pipesToApply = [
          ...(isPipedParameterKind(param.kind) ? (route.pipes ?? []) : []),
          ...(param.pipes ?? []),
        ];
        const resolved = Object.freeze(pipesToApply.map((p) => resolvePipe(p)));
        const argType: ArgumentType =
          param.kind === "params"
            ? "param"
            : param.kind === "body" ||
                param.kind === "query" ||
                param.kind === "headers" ||
                param.kind === "cookie"
              ? param.kind
              : "custom";
        const declaredType = route.declaredParameterTypes?.[param.index];
        const metatype =
          typeof declaredType === "function" ? (declaredType as ClassToken<unknown>) : undefined;
        const dataString =
          typeof param.data === "string"
            ? param.data
            : typeof param.property === "string"
              ? param.property
              : undefined;
        const metadata: ArgumentMetadata = Object.freeze({
          type: argType,
          data: dataString,
          metatype,
        });
        return Object.freeze({
          index: param.index,
          kind: param.kind,
          property: param.property,
          factory: param.factory,
          data: param.data,
          pipes: resolved,
          metadata,
        });
      }),
    );

    return async (context: RouteContext) => {
      // Fast path: avoid dynamic array allocation by pre-sizing and direct indexing
      switch (argumentCount) {
        case 1: {
          const plan0 = parameterPlans[0]!;
          const raw0 = extractParameterValue(
            context,
            plan0.kind,
            plan0.property,
            plan0.factory,
            plan0.data,
          );
          const arg0 =
            plan0.pipes.length > 0 ? await executePipes(plan0.pipes, raw0, plan0.metadata) : raw0;
          return await handler.call(instance, arg0);
        }
        case 2: {
          const plan0 = parameterPlans[0]!;
          const raw0 = extractParameterValue(
            context,
            plan0.kind,
            plan0.property,
            plan0.factory,
            plan0.data,
          );
          const arg0 =
            plan0.pipes.length > 0 ? await executePipes(plan0.pipes, raw0, plan0.metadata) : raw0;

          const plan1 = parameterPlans[1]!;
          const raw1 = extractParameterValue(
            context,
            plan1.kind,
            plan1.property,
            plan1.factory,
            plan1.data,
          );
          const arg1 =
            plan1.pipes.length > 0 ? await executePipes(plan1.pipes, raw1, plan1.metadata) : raw1;
          return await handler.call(instance, arg0, arg1);
        }
        case 3: {
          const plan0 = parameterPlans[0]!;
          const raw0 = extractParameterValue(
            context,
            plan0.kind,
            plan0.property,
            plan0.factory,
            plan0.data,
          );
          const arg0 =
            plan0.pipes.length > 0 ? await executePipes(plan0.pipes, raw0, plan0.metadata) : raw0;

          const plan1 = parameterPlans[1]!;
          const raw1 = extractParameterValue(
            context,
            plan1.kind,
            plan1.property,
            plan1.factory,
            plan1.data,
          );
          const arg1 =
            plan1.pipes.length > 0 ? await executePipes(plan1.pipes, raw1, plan1.metadata) : raw1;

          const plan2 = parameterPlans[2]!;
          const raw2 = extractParameterValue(
            context,
            plan2.kind,
            plan2.property,
            plan2.factory,
            plan2.data,
          );
          const arg2 =
            plan2.pipes.length > 0 ? await executePipes(plan2.pipes, raw2, plan2.metadata) : raw2;
          return await handler.call(instance, arg0, arg1, arg2);
        }
        default: {
          const arguments_: unknown[] = Array.from({ length: argumentCount });
          for (let i = 0; i < parameterPlans.length; i++) {
            const plan = parameterPlans[i]!;
            const rawValue = extractParameterValue(
              context,
              plan.kind,
              plan.property,
              plan.factory,
              plan.data,
            );
            arguments_[plan.index] =
              plan.pipes.length > 0
                ? await executePipes(plan.pipes, rawValue, plan.metadata)
                : rawValue;
          }
          return await handler.call(instance, ...arguments_);
        }
      }
    };
  }

  if (route.parameters.length === 0) {
    const argumentsSource = expectsContextArgument(handler, route.declaredParameterCount)
      ? "context"
      : "";
    return compileRouteHandler(argumentsSource, isPossiblyAsync(handler, route.declaredReturnKind))(
      handler,
      instance,
    );
  }

  const arguments_ = Array.from({ length: route.parameters.at(-1)!.index + 1 }, () => "undefined");
  for (const parameter of route.parameters) {
    arguments_[parameter.index] = parameterExpression(parameter);
  }

  return compileRouteHandler(
    arguments_.join(","),
    isPossiblyAsync(handler, route.declaredReturnKind),
  )(handler, instance);
}

function expectsContextArgument(
  handler: (...arguments_: unknown[]) => unknown,
  declaredParameterCount: number | undefined,
): boolean {
  if (declaredParameterCount !== undefined && declaredParameterCount > 0) {
    return true;
  }
  if (handler.length > 0) {
    return true;
  }

  const source = maskNonCode(Function.prototype.toString.call(handler));
  if (usesArgumentsObject(source)) {
    return true;
  }
  if (declaredParameterCount === 0) {
    return false;
  }

  const openingParenthesis = source.indexOf("(");
  const closingParenthesis = source.indexOf(")", openingParenthesis + 1);
  if (openingParenthesis < 0 || closingParenthesis < 0) {
    return true;
  }

  return source.slice(openingParenthesis + 1, closingParenthesis).trim().length > 0;
}

function usesArgumentsObject(source: string): boolean {
  for (const match of source.matchAll(/\barguments\b/g)) {
    const index = match.index;
    const previous = source.slice(0, index).trimEnd().at(-1);
    const next = source.slice(index + match[0].length).trimStart()[0];
    if (previous !== "." && next !== ":") {
      return true;
    }
  }

  return false;
}

// Interpolated templates deliberately remain visible: an expression inside
// `${...}` can legitimately read the legacy `arguments` object.
const nonCodeSource =
  /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\$]|\$(?!\{))*`|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|\/(?![*/])(?:\\[\s\S]|[^/\\\n\r])+\/[dgimsuvy]*/g;

function maskNonCode(source: string): string {
  return source.replaceAll(nonCodeSource, (match) => " ".repeat(match.length));
}

type RouteHandlerFactory = (
  handler: (...arguments_: unknown[]) => unknown,
  instance: unknown,
) => (context: RouteContext) => unknown;

const routeHandlerFactories = new Map<string, RouteHandlerFactory>();

function compileRouteHandler(argumentsSource: string, possiblyAsync: boolean): RouteHandlerFactory {
  const cacheKey = `${possiblyAsync ? "async" : "sync"}:${argumentsSource}`;
  const cached = routeHandlerFactories.get(cacheKey);
  if (cached) {
    return cached;
  }

  const invocation = `handler.call(instance${argumentsSource ? `,${argumentsSource}` : ""})`;
  const parameter = argumentsSource ? "context" : "()";
  const routeHandlerSource = possiblyAsync
    ? `async ${parameter}=>${invocation}`
    : `${parameter}=>${invocation}`;

  // Elysia's AOT compiler also generates functions. Property names in this
  // source are JSON-encoded, while handler and instance remain closed values.
  // oxlint-disable-next-line typescript/no-implied-eval
  const factory = Function(
    "handler",
    "instance",
    `"use strict";return ${routeHandlerSource}`,
  ) as RouteHandlerFactory;
  routeHandlerFactories.set(cacheKey, factory);
  return factory;
}

/**
 * Compiles a direct monomorphic invoker for controller methods.
 * Strips context arguments on zero-parameter endpoints and provides direct
 * property accessors without generic spreading for single- and multi-param handlers.
 *
 * @internal
 */
export function compileDirectMonomorphicInvoker(
  instance: any,
  handlerName: string,
  paramBindings: readonly ParameterBinding[],
  isSync: boolean,
): Function {
  // 1. Zero-argument context stripping (Pure Raw Elysia speed)
  if (paramBindings.length === 0) {
    return isSync
      ? function zeroArgSyncInvoker() {
          return instance[handlerName]();
        }
      : async function zeroArgAsyncInvoker() {
          return await instance[handlerName]();
        };
  }

  // 2. Direct property bindings (1 param)
  if (paramBindings.length === 1) {
    const b0 = paramBindings[0]!;
    const src = b0.source;
    const key = b0.key;

    if (key) {
      return isSync
        ? function singlePropSyncInvoker(c: any) {
            return instance[handlerName](c[src]?.[key]);
          }
        : async function singlePropAsyncInvoker(c: any) {
            return await instance[handlerName](c[src]?.[key]);
          };
    }

    return isSync
      ? function singleSourceSyncInvoker(c: any) {
          return instance[handlerName](c[src]);
        }
      : async function singleSourceAsyncInvoker(c: any) {
          return await instance[handlerName](c[src]);
        };
  }

  // 3. Multi-property bindings
  return isSync
    ? function multiParamSyncInvoker(c: any) {
        const args = Array.from<unknown>({ length: paramBindings.length });
        for (let i = 0; i < paramBindings.length; i++) {
          const b = paramBindings[i]!;
          args[i] = b.key ? c[b.source]?.[b.key] : c[b.source];
        }
        return instance[handlerName](...args);
      }
    : async function multiParamAsyncInvoker(c: any) {
        const args = Array.from<unknown>({ length: paramBindings.length });
        for (let i = 0; i < paramBindings.length; i++) {
          const b = paramBindings[i]!;
          args[i] = b.key ? c[b.source]?.[b.key] : c[b.source];
        }
        return await instance[handlerName](...args);
      };
}

/**
 * Only two signals can settle the classification: the handler's own function
 * kind, and the return type TypeScript emitted beside its decorators. Anything
 * else is treated as Promise-capable.
 *
 * The handler source is deliberately never consulted. A Promise returned
 * through an expression that is not a call (`return this.pendingLookup`) leaves
 * no trace in the source, so a source pattern that misses it compiles a
 * synchronous invoker, and Elysia then runs `onAfterHandle` before it awaits
 * the Promise, exposing the raw Promise to the lifecycle. Classifying an
 * unprovable route as Promise-capable costs one already-settled `await`; the
 * opposite mistake breaks the route contract.
 */
function isPossiblyAsync(
  handler: (...arguments_: unknown[]) => unknown,
  declaredReturnKind: CompiledElysiaRoute["declaredReturnKind"],
): boolean {
  if (
    handler.constructor.name === "AsyncFunction" ||
    handler.constructor.name === "AsyncGeneratorFunction"
  ) {
    return true;
  }

  return declaredReturnKind !== "synchronous";
}

function parameterExpression(parameter: RouteParameterMetadata): string {
  const source = contextSource(parameter);
  if (parameter.property === undefined) {
    return source;
  }

  const property = JSON.stringify(parameter.property);
  const value = `${source}[${property}]`;
  const selected = parameter.kind === "cookie" ? `${value}?.value` : value;
  return `(typeof ${source}==="object"&&${source}!==null?${selected}:undefined)`;
}

function contextSource(parameter: RouteParameterMetadata): string {
  switch (parameter.kind) {
    case "context":
      return "context";
    case "set":
      return "context.set";
    case "request":
      return "context.request";
    default:
      return `context.${parameter.kind}`;
  }
}

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
function toRouteHook(
  route: CompiledElysiaRoute,
  controller: ClassToken<unknown>,
  handler: (...arguments_: unknown[]) => unknown,
  guards: readonly CanActivate[],
  interceptors: readonly Interceptor[],
  exceptionHooks: ElysiaErrorHook[] | undefined,
  hasCustomFilters = false,
): ElysiaRouteHook | undefined {
  const schemaHook = toSchemaHook(route.schema);
  const lifecycleHook = createLifecycleHook(
    route,
    controller,
    handler,
    guards,
    interceptors,
    hasCustomFilters,
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
 */
function createLifecycleHook(
  route: CompiledElysiaRoute,
  controller: ClassToken<unknown>,
  handler: (...arguments_: unknown[]) => unknown,
  guards: readonly CanActivate[],
  interceptors: readonly Interceptor[],
  hasCustomFilters = false,
): RouteLifecycleHook | undefined {
  const hasInterceptBefore = interceptors.some(
    (interceptor) => interceptor.interceptBefore !== undefined,
  );
  const runsBefore = guards.length > 0 || hasInterceptBefore;
  const runsAfter = interceptors.some((interceptor) => interceptor.interceptAfter !== undefined);
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
    if (guardHook !== undefined && !hasInterceptBefore) {
      beforeHandle = guardHook as (context: RouteContext) => unknown;
    } else {
      beforeHandle = async function (context: RouteContext): Promise<unknown> {
        if (guardHook !== undefined) {
          const guardResult = guardHook(context);
          if (guardResult !== undefined) {
            const settled = guardResult instanceof Promise ? await guardResult : guardResult;
            if (settled !== undefined) {
              return settled;
            }
          }
        } else if (guards.length > 0) {
          execContext.swap(context);
          for (let i = 0; i < guards.length; i++) {
            const result = guards[i]!.canActivate(execContext);
            const allowed =
              typeof (result as Promise<boolean>)?.then === "function" ? await result : result;
            if (allowed === false) {
              throw httpErrors.forbidden("A guard refused this request.");
            }
          }
        }

        for (let i = 0; i < interceptors.length; i++) {
          const interceptor = interceptors[i]!;
          if (interceptor.interceptBefore !== undefined) {
            execContext.swap(context);
            const res = interceptor.interceptBefore(execContext);
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
            execContext.swap(context);
            // `undefined` is the one answer that leaves the response as it is,
            // so the value a half answers with is what the next one receives and
            // a half that answers nothing keeps what the response carries.
            // `null`, `false`, and `0` are responses, not absences.
            let response = context.responseValue;
            for (const interceptor of afterInterceptors) {
              const answered = await interceptor.interceptAfter?.(execContext, response);
              if (answered !== undefined) {
                response = answered;
              }
            }

            return response;
          },
        }
      : {}),
  };
}

function toSchemaHook(schema: RouteSchema | undefined): ElysiaRouteHook | undefined {
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
 * Validation models unwrap once during route registration. A Standard Schema
 * validator and a platform-native TypeBox schema both satisfy the neutral
 * `RouteValidator` contract, which Elysia accepts as a schema unchanged, so no
 * branch is needed here.
 */
function toElysiaSchema(validator: RouteValidatorInput): AnySchema {
  return resolveRouteValidator(validator);
}

function toElysiaResponseSchema(
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

/**
 * @internal
 */
export function joinPaths(controllerPath: string, routePath: string): string {
  const segments = [controllerPath, routePath]
    .map((path) => path.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
