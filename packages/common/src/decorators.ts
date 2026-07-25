import "reflect-metadata";
import type { ModuleDefinition } from "./module.ts";
import type { Provider } from "./provider.ts";
import type { ClassToken, Token } from "./token.ts";

export type ModuleClass = ClassToken<unknown>;
export type ModuleImport = ModuleClass | ModuleDefinition;
export type ModuleProvider = ClassToken<unknown> | Provider;

export interface ModuleMetadata {
  readonly imports?: readonly ModuleImport[];
  readonly controllers?: readonly ClassToken<unknown>[];
  readonly providers?: readonly ModuleProvider[];
  readonly exports?: readonly Token<unknown>[];
}

export interface ControllerMetadata {
  readonly path: string;
}

export type RequestMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface RouteMetadata {
  readonly method: RequestMethod;
  readonly path: string;
  readonly propertyKey: string | symbol;
}

const modules = new WeakMap<Function, Readonly<ModuleMetadata>>();
const controllers = new WeakMap<Function, Readonly<ControllerMetadata>>();
const routes = new WeakMap<object, RouteMetadata[]>();
const injectedTokens = new WeakMap<Function, Map<number, Token<unknown>>>();

export function Module(metadata: ModuleMetadata): ClassDecorator {
  const normalized = Object.freeze({
    imports: Object.freeze([...(metadata.imports ?? [])]),
    controllers: Object.freeze([...(metadata.controllers ?? [])]),
    providers: Object.freeze([...(metadata.providers ?? [])]),
    exports: Object.freeze([...(metadata.exports ?? [])]),
  });

  return (target) => {
    modules.set(target, normalized);
  };
}

export function Injectable(): ClassDecorator {
  return () => {};
}

export function Controller(path = ""): ClassDecorator {
  return (target) => {
    controllers.set(target, Object.freeze({ path }));
  };
}

export function Inject(token: Token<unknown>): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const constructor = typeof target === "function" ? target : target.constructor;
    const parameters = injectedTokens.get(constructor) ?? new Map<number, Token<unknown>>();
    parameters.set(parameterIndex, token);
    injectedTokens.set(constructor, parameters);
  };
}

export const Delete = createRouteDecorator("DELETE");
export const Get = createRouteDecorator("GET");
export const Patch = createRouteDecorator("PATCH");
export const Post = createRouteDecorator("POST");
export const Put = createRouteDecorator("PUT");

export function getModuleMetadata(target: ModuleClass): Readonly<ModuleMetadata> | undefined {
  return modules.get(target);
}

export function getControllerMetadata(
  target: ClassToken<unknown>,
): Readonly<ControllerMetadata> | undefined {
  return controllers.get(target);
}

export function getRouteMetadata(target: ClassToken<unknown>): readonly RouteMetadata[] {
  return Object.freeze([...(routes.get(target.prototype) ?? [])]);
}

export function getConstructorDependencies(target: ClassToken<unknown>): readonly Token<unknown>[] {
  const reflected =
    (Reflect.getMetadata("design:paramtypes", target) as readonly unknown[] | undefined) ?? [];
  const explicit = injectedTokens.get(target);
  const explicitLength = explicit
    ? Math.max(0, ...[...explicit.keys()].map((index) => index + 1))
    : 0;
  const length = Math.max(reflected.length, explicitLength);

  return Object.freeze(
    Array.from({ length }, (_, index) => explicit?.get(index) ?? asToken(reflected[index], target)),
  );
}

function createRouteDecorator(method: RequestMethod) {
  return (path = ""): MethodDecorator =>
    (target, propertyKey) => {
      const controllerRoutes = routes.get(target) ?? [];
      controllerRoutes.push(Object.freeze({ method, path, propertyKey }));
      routes.set(target, controllerRoutes);
    };
}

function asToken(value: unknown, target: ClassToken<unknown>): Token<unknown> {
  if (typeof value === "function") {
    return value as ClassToken<unknown>;
  }

  throw new TypeError(
    `Cannot resolve a constructor dependency for "${target.name}". Use @Inject(token) for non-class tokens.`,
  );
}
