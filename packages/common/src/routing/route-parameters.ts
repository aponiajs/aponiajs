import "reflect-metadata";
import type { ClassToken } from "../tokens/token.types.ts";
import type { RouteParameterKind, RouteParameterMetadata } from "./route-parameters.types.ts";

/**
 * The parameter kinds a handler binds to, in canonical order.
 *
 * Each kind maps to one parameter decorator (`Body`, `Query`, and the rest);
 * the platform compiles the context-to-argument mapping once while mounting.
 */
export const routeParameterKinds = [
  "body",
  "query",
  "params",
  "headers",
  "cookie",
  "store",
  "context",
  "request",
  "set",
  "status",
] as const;

const routeParametersMetadataKey = Symbol.for("aponia.route-parameters.metadata");

/**
 * Injects the validated request body, or one of its properties.
 *
 * @param property - The body property to inject, or the whole body when omitted.
 * @returns A parameter decorator recording the binding.
 *
 * @example
 * ```ts
 * create(@Body() input: CreateUser) {}
 * ```
 */
export const Body = createParameterDecorator("body");
/**
 * Injects the parsed query string, or one of its properties.
 *
 * @param property - The query key to inject, or the whole query when omitted.
 * @returns A parameter decorator recording the binding.
 *
 * @example
 * ```ts
 * findAll(@Query("page") page?: string) {}
 * ```
 */
export const Query = createParameterDecorator("query");
/**
 * Injects the path parameters, or a single named parameter.
 *
 * @param property - The path key to inject, or the whole params object when omitted.
 * @returns A parameter decorator recording the binding.
 *
 * @example
 * ```ts
 * findOne(@Param("id") id: string) {}
 * ```
 */
export const Param = createParameterDecorator("params");
/**
 * Injects the request headers, or a single named header.
 *
 * @param property - The header name to inject, or all headers when omitted.
 * @returns A parameter decorator recording the binding.
 *
 * @example
 * ```ts
 * read(@Headers("authorization") authorization?: string) {}
 * ```
 */
export const Headers = createParameterDecorator("headers");
/**
 * Injects the request cookies, or the value of a single named cookie.
 *
 * @param property - The cookie name to inject, or all cookies when omitted.
 * @returns A parameter decorator recording the binding.
 */
export const Cookie = createParameterDecorator("cookie");
/**
 * Injects application state, or one named state value.
 *
 * @param property - The state key to inject, or the whole store when omitted.
 * @returns A parameter decorator recording the binding.
 */
export const State = createParameterDecorator("store");
/**
 * Injects the whole platform request context.
 *
 * @returns A parameter decorator recording the binding.
 *
 * @example
 * ```ts
 * read(@Context() context: RouteContext) {}
 * ```
 */
export const Context = createParameterDecorator("context");
/**
 * Injects the native `Request`.
 *
 * @returns A parameter decorator recording the binding.
 */
export const Req = createParameterDecorator("request");
/**
 * Injects the mutable response settings using the platform context name.
 *
 * @returns A parameter decorator recording the binding.
 */
export const ResponseSettings = createParameterDecorator("set");
/**
 * Injects the platform's type-narrowing response status helper.
 *
 * @returns A parameter decorator recording the binding.
 */
export const HttpStatus = createParameterDecorator("status");

/**
 * Reads the parameter bindings the route parameter decorators recorded for one
 * handler, in parameter order.
 *
 * @param target - The controller class to read.
 * @param propertyKey - The handler method to read.
 * @returns The frozen binding list, empty when the handler declares none.
 */
export function getRouteParameterMetadata(
  target: ClassToken<unknown>,
  propertyKey: string | symbol,
): readonly RouteParameterMetadata[] {
  const parametersByMethod = Reflect.getOwnMetadata(
    routeParametersMetadataKey,
    target.prototype,
  ) as ReadonlyMap<string | symbol, readonly RouteParameterMetadata[]> | undefined;
  const parameters = parametersByMethod?.get(propertyKey) ?? [];
  return Object.freeze([...parameters].toSorted((left, right) => left.index - right.index));
}

function createParameterDecorator(kind: RouteParameterKind) {
  return (property?: string): ParameterDecorator =>
    (target, propertyKey, parameterIndex) => {
      if (propertyKey === undefined) {
        throw new TypeError(`@${kind} can only decorate a route handler parameter.`);
      }

      const parametersByMethod =
        (Reflect.getOwnMetadata(routeParametersMetadataKey, target) as
          | ReadonlyMap<string | symbol, readonly RouteParameterMetadata[]>
          | undefined) ?? new Map<string | symbol, readonly RouteParameterMetadata[]>();
      const methodParameters = parametersByMethod.get(propertyKey) ?? [];
      const updated = new Map(parametersByMethod);
      updated.set(
        propertyKey,
        Object.freeze([
          ...methodParameters,
          Object.freeze({ index: parameterIndex, kind, property }),
        ]),
      );

      Reflect.defineMetadata(routeParametersMetadataKey, updated, target);
    };
}
