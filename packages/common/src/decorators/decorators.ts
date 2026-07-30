import "reflect-metadata";
import { isRouteResponseSchemaMap } from "../routing/route-schema.ts";
import type { RouteSchema } from "../routing/route-schema.types.ts";
import type { ClassToken, Token } from "../tokens/token.types.ts";
import type {
  ControllerMetadata,
  ModuleClass,
  ModuleMetadata,
  RequestMethod,
  RouteDecoratorFactory,
  RouteMetadata,
} from "./decorators.types.ts";

const moduleMetadataKey = Symbol.for("aponia.module.metadata");
const controllerMetadataKey = Symbol.for("aponia.controller.metadata");
const routeMetadataKey = Symbol.for("aponia.route.metadata");
const injectedTokensMetadataKey = Symbol.for("aponia.injected-tokens.metadata");

export function Module(metadata: ModuleMetadata): ClassDecorator {
  const normalized = Object.freeze({
    imports: Object.freeze([...(metadata.imports ?? [])]),
    controllers: Object.freeze([...(metadata.controllers ?? [])]),
    providers: Object.freeze([...(metadata.providers ?? [])]),
    exports: Object.freeze([...(metadata.exports ?? [])]),
  });

  return (target) => {
    Reflect.defineMetadata(moduleMetadataKey, normalized, target);
  };
}

export function Injectable(): ClassDecorator {
  return () => {};
}

export function Controller(path = ""): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(controllerMetadataKey, Object.freeze({ path }), target);
  };
}

export function Inject(token: Token<unknown>): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const constructor = typeof target === "function" ? target : target.constructor;
    const parameters =
      (Reflect.getOwnMetadata(injectedTokensMetadataKey, constructor) as
        | ReadonlyMap<number, Token<unknown>>
        | undefined) ?? new Map<number, Token<unknown>>();
    const updatedParameters = new Map(parameters);
    updatedParameters.set(parameterIndex, token);
    Reflect.defineMetadata(injectedTokensMetadataKey, updatedParameters, constructor);
  };
}

export const Delete = createRouteDecorator("DELETE");
export const Get = createRouteDecorator("GET");
export const Head = createRouteDecorator("HEAD");
export const Options = createRouteDecorator("OPTIONS");
export const Patch = createRouteDecorator("PATCH");
export const Post = createRouteDecorator("POST");
export const Put = createRouteDecorator("PUT");

export function getModuleMetadata(target: ModuleClass): Readonly<ModuleMetadata> | undefined {
  return Reflect.getOwnMetadata(moduleMetadataKey, target) as Readonly<ModuleMetadata> | undefined;
}

export function getControllerMetadata(
  target: ClassToken<unknown>,
): Readonly<ControllerMetadata> | undefined {
  return Reflect.getOwnMetadata(controllerMetadataKey, target) as
    | Readonly<ControllerMetadata>
    | undefined;
}

export function getRouteMetadata(target: ClassToken<unknown>): readonly RouteMetadata[] {
  const routes =
    (Reflect.getOwnMetadata(routeMetadataKey, target.prototype) as
      | readonly RouteMetadata[]
      | undefined) ?? [];
  return Object.freeze([...routes]);
}

export function getConstructorDependencies(target: ClassToken<unknown>): readonly Token<unknown>[] {
  const reflected =
    (Reflect.getMetadata("design:paramtypes", target) as readonly unknown[] | undefined) ?? [];
  const explicit = Reflect.getOwnMetadata(injectedTokensMetadataKey, target) as
    | ReadonlyMap<number, Token<unknown>>
    | undefined;
  const explicitLength = explicit
    ? Math.max(0, ...[...explicit.keys()].map((index) => index + 1))
    : 0;
  const length = Math.max(reflected.length, explicitLength);

  return Object.freeze(
    Array.from({ length }, (_, index) => explicit?.get(index) ?? asToken(reflected[index], target)),
  );
}

function createRouteDecorator(method: RequestMethod): RouteDecoratorFactory {
  return ((pathOrSchema?: string | RouteSchema, maybeSchema?: RouteSchema) => {
    const path = typeof pathOrSchema === "string" ? pathOrSchema : "";
    const schema = typeof pathOrSchema === "string" ? maybeSchema : pathOrSchema;

    return (target: object, propertyKey: string | symbol) => {
      const controllerRoutes =
        (Reflect.getOwnMetadata(routeMetadataKey, target) as
          | readonly RouteMetadata[]
          | undefined) ?? [];
      Reflect.defineMetadata(
        routeMetadataKey,
        Object.freeze([
          ...controllerRoutes,
          Object.freeze({
            method,
            path,
            propertyKey,
            schema: schema ? freezeRouteSchema(schema) : undefined,
          }),
        ]),
        target,
      );
    };
  }) as RouteDecoratorFactory;
}

function freezeRouteSchema(schema: RouteSchema): Readonly<RouteSchema> {
  const response = schema.response;
  return Object.freeze({
    ...schema,
    ...(response && isRouteResponseSchemaMap(response)
      ? { response: Object.freeze({ ...response }) }
      : {}),
  });
}

function asToken(value: unknown, target: ClassToken<unknown>): Token<unknown> {
  if (typeof value === "function") {
    return value as ClassToken<unknown>;
  }

  throw new TypeError(
    `Cannot resolve a constructor dependency for "${target.name}". Use @Inject(token) for non-class tokens.`,
  );
}
