import type { RouteParameterKind, RouteParameterMetadata } from "@aponiajs/common";
import { executePipes, resolvePipe } from "../pipes/pipe.resolver.ts";
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
      return new URL(context.request.url).host;
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
export async function buildArguments(
  parameters: readonly RouteParameterMetadata[],
  context: PlatformRouteContext,
  declaredParameterCount: number | undefined,
  handlerLength: number,
  routePipes: readonly ResolvedPipe[],
  globalPipes: readonly ResolvedPipe[],
): Promise<unknown[]> {
  if (parameters.length === 0) {
    if ((declaredParameterCount ?? 0) > 0 || handlerLength > 0) {
      return [context];
    }
    return [];
  }

  const argumentCount = (parameters.at(-1)?.index ?? -1) + 1;
  const args = Array.from<unknown>({ length: argumentCount });

  for (const parameter of parameters) {
    let value = readParameterValue(context, parameter);
    const sharedPipes = pipedKinds.has(parameter.kind) ? [...globalPipes, ...routePipes] : [];
    const parameterPipes = (parameter.pipes ?? []).map((pipe) => resolvePipe(pipe));
    const pipes = [...sharedPipes, ...parameterPipes];
    if (pipes.length > 0) {
      value = await executePipes(pipes, value, {
        type: parameter.kind === "custom" ? "custom" : parameterKindToArgument(parameter.kind),
        data: parameter.property,
      });
    }
    args[parameter.index] = value;
  }

  return args;
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
