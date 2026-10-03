import type { ModuleDefinition } from "../modules/module.types.ts";
import type { Provider } from "../providers/provider.types.ts";
import type { RouteSchema } from "../routing/route-schema.types.ts";
import type { ClassToken, Token } from "../tokens/token.types.ts";

/** A class carrying `@Module()` metadata. */
export type ModuleClass = ClassToken<unknown>;
/** Anything a module's `imports` accepts: a class, a lowered descriptor, or a registration. */
export type ModuleImport = ModuleClass | ModuleDefinition | DynamicModule;
/** Anything a module's `providers` accepts: a class, or a provider descriptor. */
export type ModuleProvider = ClassToken<unknown> | Provider;

/** The `@Module()` declaration as written, before lowering. */
export interface ModuleMetadata {
  /** The already-lowered or to-be-lowered modules this module resolves against. */
  readonly imports?: readonly ModuleImport[];
  /** The controller classes this module mounts. */
  readonly controllers?: readonly ClassToken<unknown>[];
  /** The providers and provider descriptors this module declares. */
  readonly providers?: readonly ModuleProvider[];
  /** The tokens importers may resolve. */
  readonly exports?: readonly Token<unknown>[];
}

/**
 * A registration: a runtime module value carrying its class, identity, and
 * the collections the graph compiles.
 */
export interface DynamicModule extends ModuleMetadata {
  /** The class `register` hangs off; the identity is the registration's, not this class's. */
  readonly module: ModuleClass;
  /** The module identity the graph keys the registration by. */
  readonly id: string;
  /** The configured-instance identity keeping two registrations distinct. */
  readonly instanceId: symbol;
}

/** The `@Controller()` declaration as written: the path prefix routes mount under. */
export interface ControllerMetadata {
  readonly path: string;
}

/** The HTTP methods a route decorator declares. */
export type RequestMethod = "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

/** One route a controller method declares, in declaration order. */
export interface RouteMetadata {
  /** The HTTP method the route answers. */
  readonly method: RequestMethod;
  /** The path joined under the controller prefix. */
  readonly path: string;
  /** The handler method carrying this route. */
  readonly propertyKey: string | symbol;
  /** The route schema, or `undefined` for an unvalidated route. */
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

/** The route decorator factory each HTTP method constant is built with. */
export interface RouteDecoratorFactory {
  (path: string, schema: RouteSchema): RouteMethodDecorator;
  (schema: RouteSchema): RouteMethodDecorator;
  (path?: string): RouteMethodDecorator;
}
