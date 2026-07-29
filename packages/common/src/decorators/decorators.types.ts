import type { ModuleDefinition } from "../modules/module.types.ts";
import type { Provider } from "../providers/provider.types.ts";
import type { RouteSchema } from "../routing/route-schema.types.ts";
import type { ClassToken, Token } from "../tokens/token.types.ts";

export type ModuleClass = ClassToken<unknown>;
export type ModuleImport = ModuleClass | ModuleDefinition | DynamicModule;
export type ModuleProvider = ClassToken<unknown> | Provider;

export interface ModuleMetadata {
  readonly imports?: readonly ModuleImport[];
  readonly controllers?: readonly ClassToken<unknown>[];
  readonly providers?: readonly ModuleProvider[];
  readonly exports?: readonly Token<unknown>[];
}

export interface DynamicModule extends ModuleMetadata {
  readonly module: ModuleClass;
  readonly id: string;
  readonly instanceId: symbol;
}

export interface ControllerMetadata {
  readonly path: string;
}

export type RequestMethod = "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

export interface RouteMetadata {
  readonly method: RequestMethod;
  readonly path: string;
  readonly propertyKey: string | symbol;
  readonly schema: RouteSchema | undefined;
}

/**
 * A handler's arguments are supplied by the platform from its parameter
 * decorators, and their types come from the handler's own annotations, so the
 * decorator accepts any callable member.
 */
export type RouteMethodDecorator = <THandler extends (...parameters: never[]) => unknown>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<THandler>,
) => void;

export interface RouteDecoratorFactory {
  (path: string, schema: RouteSchema): RouteMethodDecorator;
  (schema: RouteSchema): RouteMethodDecorator;
  (path?: string): RouteMethodDecorator;
}
