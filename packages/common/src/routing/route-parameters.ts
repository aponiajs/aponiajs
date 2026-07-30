import "reflect-metadata";
import type { ClassToken } from "../tokens/token.types.ts";
import type { RouteParameterKind, RouteParameterMetadata } from "./route-parameters.types.ts";

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

/** Injects the validated request body, or one of its properties. */
export const Body = createParameterDecorator("body");
/** Injects the parsed query string, or one of its properties. */
export const Query = createParameterDecorator("query");
/** Injects the path parameters, or a single named parameter. */
export const Param = createParameterDecorator("params");
/** Injects the request headers, or a single named header. */
export const Headers = createParameterDecorator("headers");
/** Injects the request cookies, or the value of a single named cookie. */
export const Cookie = createParameterDecorator("cookie");
/** Injects application state, or one named state value. */
export const Store = createParameterDecorator("store");
/** Injects the whole platform request context. */
export const Ctx = createParameterDecorator("context");
/** Injects the native `Request`. */
export const Req = createParameterDecorator("request");
/** Injects the mutable response settings using the platform context name. */
export const Set = createParameterDecorator("set");
/** Nest-style alias for `Set`. */
export const Res = Set;
/** Injects the platform's type-narrowing response status helper. */
export const Status = createParameterDecorator("status");

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
