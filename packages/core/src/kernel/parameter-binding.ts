import type {
  ArgumentMetadata,
  RouteParameterKind,
  RouteParameterMetadata,
} from "@aponiajs/common";
import { executePipesSyncOrAsync, resolvePipe } from "../pipes/pipe.resolver.ts";
import type { ResolvedPipe } from "@aponiajs/common";
import type { PlatformRouteContext } from "@aponiajs/common";

/** The parameter kinds whose value a pipe may transform. */
const pipedKinds: ReadonlySet<RouteParameterKind> = new Set([
  "body",
  "query",
  "params",
  "headers",
  "cookie",
  "custom",
]);

/** A single pre-compiled parameter step with resolved pipes and metadata. */
export interface CompiledParameterStep {
  readonly parameter: RouteParameterMetadata;
  readonly pipes: readonly ResolvedPipe[];
  readonly metadata: ArgumentMetadata;
}

/** A boot-compiled argument extraction plan for one route handler. */
export interface CompiledArgumentPlan {
  readonly mode: "none" | "whole-context" | "parameters";
  readonly argumentCount: number;
  readonly steps: readonly CompiledParameterStep[];
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Compiles parameter extraction and pipe resolution once at boot.
 *
 * @internal
 */
export function compileParameterPlan(
  parameters: readonly RouteParameterMetadata[],
  routePipes: readonly ResolvedPipe[],
  globalPipes: readonly ResolvedPipe[],
  declaredParameterCount: number | undefined,
  handlerLength: number,
): CompiledArgumentPlan {
  if (parameters.length === 0) {
    return {
      mode: (declaredParameterCount ?? 0) > 0 || handlerLength > 0 ? "whole-context" : "none",
      argumentCount: (declaredParameterCount ?? 0) > 0 || handlerLength > 0 ? 1 : 0,
      steps: [],
    };
  }

  const argumentCount = (parameters.at(-1)?.index ?? -1) + 1;
  const steps: CompiledParameterStep[] = parameters.map((parameter) => {
    const sharedPipes = pipedKinds.has(parameter.kind) ? [...globalPipes, ...routePipes] : [];
    const parameterPipes = (parameter.pipes ?? []).map((pipe) => resolvePipe(pipe));
    return {
      parameter,
      pipes: Object.freeze([...sharedPipes, ...parameterPipes]),
      metadata: Object.freeze({
        type: parameter.kind === "custom" ? "custom" : parameterKindToArgument(parameter.kind),
        data: parameter.property,
      }),
    };
  });

  return {
    mode: "parameters",
    argumentCount,
    steps: Object.freeze(steps),
  };
}

/**
 * Reads what one parameter decorator asked for.
 *
 * @param context - The request context.
 * @param parameter - The parameter's metadata.
 * @returns The value the handler receives.
 */
export function readParameterValue(
  context: PlatformRouteContext,
  parameter: RouteParameterMetadata,
): unknown {
  if (parameter.kind === "custom") {
    return parameter.factory === undefined ? undefined : parameter.factory(parameter.data, context);
  }

  const source = readSource(context, parameter.kind);
  if (parameter.kind === "host" && parameter.property !== undefined) {
    return typeof source === "string" ? (source.split(".")[0] ?? "") : undefined;
  }
  if (parameter.property === undefined) {
    return source;
  }
  if (typeof source === "object" && source !== null) {
    const value = (source as Record<string, unknown>)[parameter.property];
    if (parameter.kind === "cookie") {
      return (value as { value?: unknown } | undefined)?.value;
    }
    return value;
  }
  return undefined;
}

function readSource(context: PlatformRouteContext, kind: RouteParameterKind): unknown {
  switch (kind) {
    case "context":
      return context;
    case "request":
      return context.request;
    case "set":
      return context.set;
    case "status":
      return context.status;
    case "store":
      return context.store;
    case "ip":
      return context.server?.requestIP?.()?.address;
    case "host":
      return context.host;
    default:
      return context[kind as "body" | "query" | "params" | "headers" | "cookie"];
  }
}

/**
 * Builds one handler call's arguments.
 *
 * A handler with no parameter decorators receives the whole context when its
 * signature takes one; a handler that takes none is called with no arguments.
 * Every declared parameter is read from the request, then transformed by the
 * application pipes, the route's own pipes, and finally the parameter's.
 *
 * @param parameters - The parameter metadata the route declared.
 * @param context - The request context.
 * @param declaredParameterCount - The parameter count TypeScript emitted.
 * @param handlerLength - The handler's own arity.
 * @param routePipes - The route's resolved pipes.
 * @param globalPipes - The application's resolved pipes.
 * @returns The arguments to call the handler with.
 */
/**
 * Evaluates a pre-compiled argument plan synchronously when all pipes are
 * synchronous, returning a Promise only when a pipe returns one.
 *
 * @internal
 */
export function buildCompiledArguments(
  plan: CompiledArgumentPlan,
  context: PlatformRouteContext,
): unknown[] | Promise<unknown[]> {
  if (plan.mode === "none") {
    return [];
  }
  if (plan.mode === "whole-context") {
    return [context];
  }

  const { steps, argumentCount } = plan;
  const args = Array.from<unknown>({ length: argumentCount });

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const raw = readParameterValue(context, step.parameter);
    const value =
      step.pipes.length > 0 ? executePipesSyncOrAsync(step.pipes, raw, step.metadata) : raw;
    if (isPromiseLike(value)) {
      return finishCompiledArgumentsAsync(plan, context, args, i, value);
    }
    args[step.parameter.index] = value;
  }

  return args;
}

async function finishCompiledArgumentsAsync(
  plan: CompiledArgumentPlan,
  context: PlatformRouteContext,
  args: unknown[],
  pendingIndex: number,
  pendingValue: PromiseLike<unknown>,
): Promise<unknown[]> {
  const { steps } = plan;
  args[steps[pendingIndex]!.parameter.index] = await pendingValue;
  for (let i = pendingIndex + 1; i < steps.length; i += 1) {
    const step = steps[i]!;
    const raw = readParameterValue(context, step.parameter);
    const value =
      step.pipes.length > 0 ? executePipesSyncOrAsync(step.pipes, raw, step.metadata) : raw;
    args[step.parameter.index] = isPromiseLike(value) ? await value : value;
  }
  return args;
}

/**
 * Builds the runtime argument array for a route handler from the request context.
 */
export async function buildArguments(
  parameters: readonly RouteParameterMetadata[],
  context: PlatformRouteContext,
  declaredParameterCount: number | undefined,
  handlerLength: number,
  routePipes: readonly ResolvedPipe[],
  globalPipes: readonly ResolvedPipe[],
): Promise<unknown[]> {
  const plan = compileParameterPlan(
    parameters,
    routePipes,
    globalPipes,
    declaredParameterCount,
    handlerLength,
  );
  return await buildCompiledArguments(plan, context);
}

function parameterKindToArgument(
  kind: RouteParameterKind,
): "body" | "query" | "param" | "headers" | "cookie" | "custom" {
  switch (kind) {
    case "query":
      return "query";
    case "params":
      return "param";
    case "cookie":
      return "cookie";
    case "headers":
      return "headers";
    default:
      return "body";
  }
}
