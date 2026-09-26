import {
  AponiaError,
  getEnhancerMetadata,
  getRouteMetadata,
  getRouteParameterMetadata,
  isRouteResponseSchemaMap,
  isStandardSchema,
  resolveRouteValidator,
  type CanActivate,
  type ClassToken,
  type EnhancerMetadata,
  type ExecutionContext,
  type HttpArgumentsHost,
  type RequestMethod,
  type RouteContext,
  type RouteParameterMetadata,
  type RouteResponseSchema,
  type RouteSchema,
  type RouteValidatorInput,
} from "@aponiajs/common";
import { type AnySchema, type Elysia, type TSchema } from "elysia";
import type { MountedRouteEnhancers } from "../controllers/enhancer-resolver.ts";
import { httpErrors } from "../errors/http-error.ts";
import { registerNativeRoute } from "./native-route.ts";
import type {
  AponiaRouteInvoker,
  CompiledElysiaRoute,
  ElysiaRouteHook,
} from "./route-compiler.types.ts";

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
  const routes = getRouteMetadata(controller).map((route): CompiledElysiaRoute => {
    const parameters = getRouteParameterMetadata(controller, route.propertyKey);
    const prototypeHandler = Object.getOwnPropertyDescriptor(
      controller.prototype,
      route.propertyKey,
    )?.value as unknown;
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
      declaredReturnKind: classifyDeclaredReturnKind(returnType),
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
 * declarations once this call site also joins them. The controller's own
 * declarations come first, then the handler's, which is the scope order the
 * enhancers run in.
 */
function mergeEnhancerMetadata(
  controllerScope: EnhancerMetadata,
  handlerScope: EnhancerMetadata,
): EnhancerMetadata {
  return Object.freeze({
    guards: Object.freeze([...controllerScope.guards, ...handlerScope.guards]),
    interceptors: Object.freeze([...controllerScope.interceptors, ...handlerScope.interceptors]),
    filters: Object.freeze([...controllerScope.filters, ...handlerScope.filters]),
  });
}

function classifyDeclaredReturnKind(
  returnType: unknown,
): CompiledElysiaRoute["declaredReturnKind"] {
  if (returnType === Promise) {
    return "promise";
  }

  // TypeScript emits Object for unknown, object, interfaces, and unions. None
  // of those categories can prove a synchronous return.
  return returnType === undefined || returnType === Object ? "unknown" : "synchronous";
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
  invokers?: ReadonlyMap<string | symbol, AponiaRouteInvoker>,
): void {
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

    // `AponiaRouteInvoker` is declared with a `never` parameter because an
    // invoker is written against its own route's annotations, so an artifact's
    // invoker is widened back to the annotation this platform calls one with.
    // The two are the same function at run time; only the variance differs, and
    // the compiler's own handler needs no widening.
    const suppliedInvoker = invokers?.get(route.propertyKey);
    registerNativeRoute(
      application,
      route.method,
      route.path,
      suppliedInvoker === undefined
        ? createRouteHandler(callableHandler, instance, route)
        : (suppliedInvoker as (context: RouteContext) => unknown),
      toRouteHook(route, controller, callableHandler, routeGuards(mountedEnhancers, route)),
    );
  }
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
 * Class constructors pass a `typeof` check and then throw when called without
 * `new`, which would surface as a raw engine message on every request. The
 * class definition's own source is the reliable signal: a class is only ever
 * written as `class ...`, and minifiers keep that leading keyword.
 */
function isClassConstructor(handler: (...arguments_: unknown[]) => unknown): boolean {
  return /^class[\s{/]/.test(Function.prototype.toString.call(handler).trimStart());
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
    : `${parameter}=>{const result=${invocation};return result}`;

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

/**
 * Builds the hook object one route is registered with: the validators its schema
 * declares, and the guards it runs before its handler.
 *
 * A route that declares no guard mounts the schema hook itself rather than a
 * copy of it, so a controller with no enhancers gains no `beforeHandle` and no
 * `ExecutionContext` is ever built for one.
 */
function toRouteHook(
  route: CompiledElysiaRoute,
  controller: ClassToken<unknown>,
  handler: (...arguments_: unknown[]) => unknown,
  guards: readonly CanActivate[],
): ElysiaRouteHook | undefined {
  const schemaHook = toSchemaHook(route.schema);
  if (guards.length === 0) {
    return schemaHook;
  }

  // The route a request was handled by never changes, so the value `getRoute`
  // answers with is frozen once here rather than on every call.
  const routeDescription = Object.freeze({ method: route.method, path: route.path });

  return {
    ...schemaHook,
    // Refusal is the throw and nothing else: Elysia answers an error carrying
    // `toResponse()` through its own native path, so the response is already
    // Problem Details with a 403 before any hook this task adds could shape it.
    async beforeHandle(context: RouteContext): Promise<void> {
      const executionContext = createExecutionContext(
        routeDescription,
        controller,
        handler,
        context,
      );
      for (const guard of guards) {
        if ((await guard.canActivate(executionContext)) === false) {
          throw httpErrors.forbidden("A guard refused this request.");
        }
      }

      return undefined;
    },
  };
}

/**
 * What a guard running for one request is given about the route it protects.
 *
 * The object is built per request because it carries the request's own context,
 * and built here rather than per guard so every guard on a route sees the same
 * one.
 */
function createExecutionContext(
  route: Readonly<{ readonly method: RequestMethod; readonly path: string }>,
  controller: ClassToken<unknown>,
  handler: (...arguments_: unknown[]) => unknown,
  context: RouteContext,
): ExecutionContext {
  const httpHost: HttpArgumentsHost = Object.freeze({ getRequest: () => context });

  return Object.freeze({
    // The token is one class, while the type argument is the guard's own claim
    // about it: nothing at run time could check that claim, so it is the one
    // place this contract is answered with a cast.
    getClass: <TController>() => controller as ClassToken<TController>,
    getHandler: () => handler as (...arguments_: never[]) => unknown,
    getRoute: () => route,
    getContext: () => context,
    switchToHttp: () => httpHost,
  });
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
 * Validation models unwrap once during route registration. Standard Schema
 * validators pass through unchanged. Platform-native TypeBox validators reach
 * the platform through the neutral `NativeSchema` contract, which cannot
 * describe TypeBox's `Kind` symbol, so they are restored here.
 */
function toElysiaSchema(validator: RouteValidatorInput): AnySchema {
  const resolvedValidator = resolveRouteValidator(validator);
  return isStandardSchema(resolvedValidator)
    ? resolvedValidator
    : (resolvedValidator as unknown as TSchema);
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
