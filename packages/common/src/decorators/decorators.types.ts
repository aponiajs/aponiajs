import type { ForwardReference } from "../modules/forward-ref.types.ts";
import type { ModuleDefinition } from "../modules/module.types.ts";
import type { NestProvider, Provider, ProviderScope } from "../providers/provider.types.ts";
import type { RouteSchema } from "../routing/route-schema.types.ts";
import type { ClassToken, Token } from "../tokens/token.types.ts";

/** Options accepted by the `@Injectable()` decorator. */
export interface InjectableOptions {
  /** The lifetime a provider instance is kept for: singleton, request, or transient. */
  readonly scope?: ProviderScope;
}

/** A class carrying `@Module()` metadata. */
export type ModuleClass = ClassToken<unknown>;

/** A token a module exports, or a module whose own exports are re-exported. */
export type ModuleExport = Token<unknown> | ModuleClass | DynamicModule;
/** Anything a module's `imports` accepts: a class, a lowered descriptor, a registration, or a forward reference. */
export type ModuleImport =
  | ModuleClass
  | ModuleDefinition
  | DynamicModule
  | ForwardReference<ModuleClass | ModuleDefinition | DynamicModule>;
/** Anything a module's `providers` accepts: a class, a canonical provider, or a Nest literal. */
export type ModuleProvider = ClassToken<unknown> | Provider | NestProvider;

/** The `@Module()` declaration as written, before lowering. */
export interface ModuleMetadata {
  /** Whether exported providers are visible globally without explicit imports. */
  readonly global?: boolean;
  /** The already-lowered or to-be-lowered modules this module resolves against. */
  readonly imports?: readonly ModuleImport[];
  /** The controller classes this module mounts. */
  readonly controllers?: readonly ClassToken<unknown>[];
  /** The providers and provider descriptors this module declares. */
  readonly providers?: readonly ModuleProvider[];
  /** The tokens importers may resolve, or modules whose exports are re-exported. */
  readonly exports?: readonly ModuleExport[];
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

/**
 * What `dynamicModule` accepts: a registration before its identity is derived.
 *
 * `id` defaults to the class name and `instanceId` to a fresh symbol, which is
 * what lets a Nest-style `forRoot()` return `{ module, providers }` without the
 * two Aponia-only identity fields.
 */
export interface DynamicModuleOptions extends ModuleMetadata {
  /** The class the registration hangs off. */
  readonly module: ModuleClass;
  /** The module identity; defaults to the class name. */
  readonly id?: string;
  /** The configured-instance identity; a fresh symbol is derived when absent. */
  readonly instanceId?: symbol;
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
