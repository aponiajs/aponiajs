// Extracted from `routing/route-compiler.ts`. The dense-plan guard in
// `createRouteHandler` is a deliberate behavior change, not movement noise: a
// decorated parameter at a non-leading index used to read a plan that does not
// exist and throw, and now binds through the positional default.
import {
  stripDangerousKeys,
  type ArgumentMetadata,
  type ArgumentType,
  type ClassToken,
  type CustomParamFactory,
  type RouteContext,
  type RouteParameterKind,
  type RouteParameterMetadata,
} from "@aponiajs/common";
import { type ResolvedPipe } from "@aponiajs/common";
import { executePipes, executePipesSyncOrAsync, resolvePipe } from "@aponiajs/core";
import type {
  CompiledElysiaRoute,
  ParameterBinding,
  RouteHandler,
} from "../interfaces/route-compiler.interface.ts";

/**
 * @internal
 */
export function hasRouteOrParameterPipes(route: CompiledElysiaRoute): boolean {
  if (route.pipes !== undefined && route.pipes.length > 0) {
    return true;
  }
  return route.parameters.some(
    (parameter) => parameter.pipes !== undefined && parameter.pipes.length > 0,
  );
}

/**
 * @internal
 */
export function hasCustomParameters(route: CompiledElysiaRoute): boolean {
  return route.parameters.some((parameter) => parameter.kind === "custom");
}

/**
 * @internal
 */
export function isPipedParameterKind(kind: RouteParameterKind): boolean {
  return (
    kind === "body" ||
    kind === "query" ||
    kind === "params" ||
    kind === "headers" ||
    kind === "cookie" ||
    kind === "ip" ||
    kind === "host"
  );
}

/**
 * @internal
 */
export interface ParameterExecutionPlan {
  readonly index: number;
  readonly kind: RouteParameterKind;
  readonly property?: string;
  readonly factory?: CustomParamFactory<unknown, unknown>;
  readonly data?: unknown;
  readonly pipes: readonly ResolvedPipe[];
  readonly metadata: ArgumentMetadata;
}

/**
 * @internal
 */
export function extractContextSourceValue(
  context: RouteContext,
  kind: RouteParameterKind,
): unknown {
  switch (kind) {
    case "context":
      return context;
    case "set":
      return context.set;
    case "request":
      return context.request;
    case "body":
      return stripDangerousKeys(context.body);
    case "query":
      return stripDangerousKeys(context.query);
    case "params":
      return stripDangerousKeys(context.params);
    case "headers":
      return stripDangerousKeys(context.headers);
    case "cookie":
      return context.cookie;
    case "ip": {
      const server = (
        context as unknown as {
          readonly server?: {
            readonly requestIP?: (request: Request) => { readonly address?: string } | null;
          } | null;
        }
      ).server;
      return server?.requestIP?.(context.request)?.address;
    }
    case "host":
      return new URL(context.request.url).host;
    default:
      return (context as unknown as Record<string, unknown>)[kind];
  }
}

/**
 * @internal
 */
export function extractParameterValue(
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
  if (kind === "host" && property !== undefined) {
    return typeof source === "string" ? (source.split(".")[0] ?? "") : undefined;
  }
  if (property === undefined) {
    return source;
  }
  if (
    (kind === "body" || kind === "query" || kind === "params" || kind === "headers") &&
    (property === "__proto__" || property === "constructor" || property === "prototype")
  ) {
    return undefined;
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
 *
 * `resolveInstance` is supplied for a request-scoped controller, whose instance
 * is constructed per request: the compiled handler still calls the method it
 * was compiled from, bound to the instance that request resolved.
 *
 * @internal
 */
export function createRouteHandler(
  handler: (...arguments_: unknown[]) => unknown,
  instance: unknown,
  route: CompiledElysiaRoute,
  globalPipes: readonly ResolvedPipe[] = [],
  resolveInstance?: () => unknown,
): (context: RouteContext) => unknown {
  // `invoke.call(instance, ...)` below is the compiled call shape; the lambda
  // ignores that `this` and binds the method to the request's own instance.
  const invoke =
    resolveInstance === undefined
      ? handler
      : (...arguments_: unknown[]) => handler.call(resolveInstance(), ...arguments_);
  if (
    (hasRouteOrParameterPipes(route) || hasCustomParameters(route) || globalPipes.length > 0) &&
    route.parameters.length > 0
  ) {
    const argumentCount = (route.parameters.at(-1)?.index ?? -1) + 1;
    const resolvedRoutePipes = Object.freeze((route.pipes ?? []).map((p) => resolvePipe(p)));
    const parameterPlans = Object.freeze(
      route.parameters.map((param): ParameterExecutionPlan => {
        const pipesToApply = [
          ...(isPipedParameterKind(param.kind) ? [...globalPipes, ...resolvedRoutePipes] : []),
          ...(param.pipes ?? []).map((p) => resolvePipe(p)),
        ];
        const resolved = Object.freeze([...pipesToApply]);
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

    if (!hasCustomParameters(route)) {
      return compilePipedRouteHandler(
        invoke,
        instance,
        parameterPlans,
        argumentCount,
        isPossiblyAsync(handler, route.declaredReturnKind),
      );
    }

    return async (context: RouteContext) => {
      // The dense fast paths below index `parameterPlans` by position; a
      // decorated parameter at a non-leading index leaves gaps, and those fall
      // through to the positional default below. They avoid a dynamic arguments
      // array by pre-sizing and indexing directly.
      switch (parameterPlans.length === argumentCount ? argumentCount : 0) {
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
          return await invoke.call(instance, arg0);
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
          return await invoke.call(instance, arg0, arg1);
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
          return await invoke.call(instance, arg0, arg1, arg2);
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
          return await invoke.call(instance, ...arguments_);
        }
      }
    };
  }

  if (route.parameters.length === 0) {
    const argumentsSource = expectsContextArgument(handler, route.declaredParameterCount)
      ? "context"
      : "";
    return compileRouteHandler(argumentsSource, isPossiblyAsync(handler, route.declaredReturnKind))(
      invoke,
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
  )(invoke, instance);
}

/**
 * @internal
 */
export function expectsContextArgument(
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

/**
 * @internal
 */
export function usesArgumentsObject(source: string): boolean {
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

/**
 * @internal
 */
export function maskNonCode(source: string): string {
  return source.replaceAll(nonCodeSource, (match) => " ".repeat(match.length));
}

type RouteHandlerFactory = (
  handler: (...arguments_: unknown[]) => unknown,
  instance: unknown,
) => (context: RouteContext) => unknown;

const routeHandlerFactories = new Map<string, RouteHandlerFactory>();

/**
 * @internal
 */
export function compileRouteHandler(
  argumentsSource: string,
  possiblyAsync: boolean,
): RouteHandlerFactory {
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

function extractPipedParameter(context: RouteContext, plan: ParameterExecutionPlan): unknown {
  return extractParameterValue(context, plan.kind, plan.property, plan.factory, plan.data);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function thenOrCall(value: unknown, next: (resolved: unknown) => unknown): unknown {
  return isPromiseLike(value) ? value.then(next) : next(value);
}

function compilePipedRouteHandler(
  handler: (...arguments_: unknown[]) => unknown,
  instance: unknown,
  parameterPlans: readonly ParameterExecutionPlan[],
  argumentCount: number,
  possiblyAsync: boolean,
): (context: RouteContext) => unknown {
  if (parameterPlans.length === 1 && argumentCount === 1) {
    const plan0 = parameterPlans[0]!;
    if (plan0.pipes.length === 0) {
      const raw0 = parameterExpression({
        index: plan0.index,
        kind: plan0.kind,
        ...(plan0.property === undefined ? {} : { property: plan0.property }),
      });
      return compileRouteHandler(raw0, possiblyAsync)(handler, instance);
    }
    if (possiblyAsync) {
      return async (context: RouteContext) => {
        const v0 = await executePipesSyncOrAsync(
          plan0.pipes,
          extractPipedParameter(context, plan0),
          plan0.metadata,
        );
        return await handler.call(instance, v0);
      };
    }
    return (context: RouteContext) =>
      thenOrCall(
        executePipesSyncOrAsync(plan0.pipes, extractPipedParameter(context, plan0), plan0.metadata),
        (v0) => handler.call(instance, v0),
      );
  }

  if (possiblyAsync) {
    return async (context: RouteContext) => {
      const args = Array.from<unknown>({ length: argumentCount });
      for (let i = 0; i < parameterPlans.length; i += 1) {
        const plan = parameterPlans[i]!;
        const raw = extractPipedParameter(context, plan);
        args[plan.index] =
          plan.pipes.length > 0
            ? await executePipesSyncOrAsync(plan.pipes, raw, plan.metadata)
            : raw;
      }
      return await handler.call(instance, ...args);
    };
  }

  return (context: RouteContext) => {
    const args = Array.from<unknown>({ length: argumentCount });
    let hasPromise = false;
    for (let i = 0; i < parameterPlans.length; i += 1) {
      const plan = parameterPlans[i]!;
      const raw = extractPipedParameter(context, plan);
      const value =
        plan.pipes.length > 0 ? executePipesSyncOrAsync(plan.pipes, raw, plan.metadata) : raw;
      if (isPromiseLike(value)) {
        hasPromise = true;
      }
      args[plan.index] = value;
    }
    if (hasPromise) {
      return Promise.all(args).then((resolved) => handler.call(instance, ...resolved));
    }
    return handler.call(instance, ...args);
  };
}

/**
 * The context a direct invoker reads from. Each `source` names a route context
 * field, whose value a binding may then select a property from.
 */
type MonomorphicInvokerContext = {
  readonly [source: string]: Record<string, unknown> | undefined;
};

/** The controller instance an invoker calls its handler method on. */
type MonomorphicInvokerTarget = Record<string, (...arguments_: unknown[]) => unknown>;

/**
 * Compiles a direct monomorphic invoker for controller methods.
 * Strips context arguments on zero-parameter endpoints and provides direct
 * property accessors without generic spreading for single- and multi-param handlers.
 *
 * @internal
 */
export function compileDirectMonomorphicInvoker(
  instance: unknown,
  handlerName: string,
  paramBindings: readonly ParameterBinding[],
  isSync: boolean,
): RouteHandler {
  const target = instance as MonomorphicInvokerTarget;
  // 1. Zero-argument context stripping (Pure Raw Elysia speed)
  if (paramBindings.length === 0) {
    return isSync
      ? function zeroArgSyncInvoker() {
          return target[handlerName]();
        }
      : async function zeroArgAsyncInvoker() {
          return await target[handlerName]();
        };
  }

  // 2. Direct property bindings (1 param)
  if (paramBindings.length === 1) {
    const b0 = paramBindings[0]!;
    const src = b0.source;
    const key = b0.key;

    if (key) {
      return isSync
        ? function singlePropSyncInvoker(c: MonomorphicInvokerContext) {
            return target[handlerName](c[src]?.[key]);
          }
        : async function singlePropAsyncInvoker(c: MonomorphicInvokerContext) {
            return await target[handlerName](c[src]?.[key]);
          };
    }

    return isSync
      ? function singleSourceSyncInvoker(c: MonomorphicInvokerContext) {
          return target[handlerName](c[src]);
        }
      : async function singleSourceAsyncInvoker(c: MonomorphicInvokerContext) {
          return await target[handlerName](c[src]);
        };
  }

  // 3. Multi-property bindings
  return isSync
    ? function multiParamSyncInvoker(c: MonomorphicInvokerContext) {
        const args = Array.from<unknown>({ length: paramBindings.length });
        for (let i = 0; i < paramBindings.length; i++) {
          const b = paramBindings[i]!;
          args[i] = b.key ? c[b.source]?.[b.key] : c[b.source];
        }
        return target[handlerName](...args);
      }
    : async function multiParamAsyncInvoker(c: MonomorphicInvokerContext) {
        const args = Array.from<unknown>({ length: paramBindings.length });
        for (let i = 0; i < paramBindings.length; i++) {
          const b = paramBindings[i]!;
          args[i] = b.key ? c[b.source]?.[b.key] : c[b.source];
        }
        return await target[handlerName](...args);
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
 *
 * @internal
 */
export function isPossiblyAsync(
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

/**
 * @internal
 */
export function parameterExpression(parameter: RouteParameterMetadata): string {
  const source = contextSource(parameter);
  if (parameter.kind === "host" && parameter.property !== undefined) {
    return `((${source}).split(".")[0]??"")`;
  }
  if (parameter.property === undefined) {
    return source;
  }

  const property = JSON.stringify(parameter.property);
  const value = `${source}[${property}]`;
  const selected = parameter.kind === "cookie" ? `${value}?.value` : value;
  return `(typeof ${source}==="object"&&${source}!==null?${selected}:undefined)`;
}

/**
 * @internal
 */
export function contextSource(parameter: RouteParameterMetadata): string {
  switch (parameter.kind) {
    case "context":
      return "context";
    case "set":
      return "context.set";
    case "request":
      return "context.request";
    case "ip":
      return "context.server?.requestIP?.(context.request)?.address";
    case "host":
      return "new URL(context.request.url).host";
    default:
      return `context.${parameter.kind}`;
  }
}
