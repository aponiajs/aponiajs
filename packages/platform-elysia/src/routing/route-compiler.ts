import {
  AponiaError,
  getRouteMetadata,
  getRouteParameterMetadata,
  isRouteResponseSchemaMap,
  isStandardSchema,
  resolveRouteValidator,
  type ClassToken,
  type RouteContext,
  type RouteParameterMetadata,
  type RouteResponseSchema,
  type RouteSchema,
  type RouteValidatorInput,
} from "@aponiajs/common";
import { type AnySchema, type Elysia, type InputSchema, type TSchema } from "elysia";
import type { CompiledElysiaRoute } from "./route-compiler.types.ts";

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
    });
  });

  return Object.freeze(routes);
}

function classifyDeclaredReturnKind(
  returnType: unknown,
): CompiledElysiaRoute["declaredReturnKind"] {
  if (returnType === Promise) {
    return "promise";
  }

  // TypeScript emits Object for unknown, object, interfaces, and unions. Those
  // categories may still contain a Promise and require conservative inference.
  return returnType === undefined || returnType === Object ? "unknown" : "synchronous";
}

/**
 * Registers compiled routes without constructing an intermediate Elysia
 * instance for the controller.
 *
 * @internal
 */
export function registerCompiledElysiaRoutes(
  application: Elysia,
  controller: ClassToken<unknown>,
  instance: unknown,
  routes: readonly CompiledElysiaRoute[],
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

    application.route(
      route.method,
      route.path,
      createRouteHandler(handler as (...arguments_: unknown[]) => unknown, instance, route),
      toRouteHook(route.schema),
    );
  }
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

const possiblyAsyncFunction = /(?:return|=>)\s?\S+\(|\b(?:async|await)\b|\bnew\s+Promise\s*\(/;

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
  if (declaredReturnKind !== "unknown") {
    return declaredReturnKind === "promise";
  }

  return possiblyAsyncFunction.test(maskNonCode(Function.prototype.toString.call(handler)));
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

function toRouteHook(schema: RouteSchema | undefined): InputSchema<never> | undefined {
  if (!schema) {
    return undefined;
  }

  const hook: InputSchema<never> = {
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
): NonNullable<InputSchema<never>["response"]> {
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
