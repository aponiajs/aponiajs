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

/**
 * Declares a module: the grouping of controllers, providers, and imports the
 * graph compiles.
 *
 * The decorator only writes `reflect-metadata`; the graph, the container, and
 * the routes are built from the lowered descriptor, never from this call.
 *
 * @param metadata - The module's imports, controllers, providers, and exports.
 * @returns A class decorator recording the frozen module metadata.
 *
 * @example
 * ```ts
 * @Module({ controllers: [AppController], providers: [AppService] })
 * class AppModule {}
 * ```
 */
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

/**
 * Marks a class as injectable so `emitDecoratorMetadata` records its
 * constructor parameter types.
 *
 * The decorator itself is a no-op: it builds no graph and no container.
 * Without it, a class nothing decorates resolves to no dependencies however
 * many parameters its constructor takes.
 *
 * @returns A class decorator recording nothing but its own presence.
 *
 * @example
 * ```ts
 * @Injectable()
 * class UsersService {}
 * ```
 */
export function Injectable(): ClassDecorator {
  return () => {};
}

/**
 * Declares a controller and the path prefix its routes mount under.
 *
 * The decorator only writes `reflect-metadata`; the platform lowers the routes
 * from the lowered descriptor, never from this call.
 *
 * @param path - The prefix joined ahead of every route path; defaults to `""`.
 * @returns A class decorator recording the frozen controller metadata.
 *
 * @example
 * ```ts
 * @Controller("users")
 * class UsersController {}
 * ```
 */
export function Controller(path = ""): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(controllerMetadataKey, Object.freeze({ path }), target);
  };
}

/**
 * Binds a constructor parameter to an explicit token.
 *
 * Needed whenever the parameter's type cannot name its own dependency: a
 * string, a configuration object, a function, or any value no class
 * describes. A parameter whose class names its own token needs no decorator.
 *
 * @param token - The token the container resolves for this parameter.
 * @returns A parameter decorator recording the token by parameter index.
 *
 * @example
 * ```ts
 * constructor(@Inject(APP_NAME) private readonly appName: string) {}
 * ```
 */
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

/**
 * Declares a `DELETE` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 *
 * @example
 * ```ts
 * @Delete(":id")
 * remove() {}
 * ```
 */
export const Delete = createRouteDecorator("DELETE");
/**
 * Declares a `GET` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 *
 * @example
 * ```ts
 * @Get()
 * findAll() {}
 * ```
 */
export const Get = createRouteDecorator("GET");
/**
 * Declares a `HEAD` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 */
export const Head = createRouteDecorator("HEAD");
/**
 * Declares an `OPTIONS` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 */
export const Options = createRouteDecorator("OPTIONS");
/**
 * Declares a `PATCH` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 *
 * @example
 * ```ts
 * @Patch(":id")
 * update() {}
 * ```
 */
export const Patch = createRouteDecorator("PATCH");
/**
 * Declares a `POST` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 *
 * @example
 * ```ts
 * @Post("/", { body: CreateUser })
 * create() {}
 * ```
 */
export const Post = createRouteDecorator("POST");
/**
 * Declares a `PUT` route on a controller method.
 *
 * Accepts a path, a route schema, or both; the schema's slots each take a raw
 * validator or a `@Validation()` model class.
 *
 * @param pathOrSchema - The route path, or the schema when the path is `""`.
 * @param maybeSchema - The schema when a path is given.
 * @returns A method decorator recording the frozen route metadata.
 */
export const Put = createRouteDecorator("PUT");

/**
 * Reads the module metadata `@Module()` recorded, own-class only.
 *
 * A subclass never inherits its parent's module metadata.
 *
 * @param target - The module class to read.
 * @returns The frozen module metadata, or `undefined` when the class declares none.
 */
export function getModuleMetadata(target: ModuleClass): Readonly<ModuleMetadata> | undefined {
  return Reflect.getOwnMetadata(moduleMetadataKey, target) as Readonly<ModuleMetadata> | undefined;
}

/**
 * Reads the controller metadata `@Controller()` recorded, own-class only.
 *
 * @param target - The controller class to read.
 * @returns The frozen controller metadata, or `undefined` when the class declares none.
 */
export function getControllerMetadata(
  target: ClassToken<unknown>,
): Readonly<ControllerMetadata> | undefined {
  return Reflect.getOwnMetadata(controllerMetadataKey, target) as
    | Readonly<ControllerMetadata>
    | undefined;
}

/**
 * Reads the route metadata the HTTP method decorators recorded, in declaration order.
 *
 * @param target - The controller class to read.
 * @returns The frozen route metadata list, empty when the class declares none.
 */
export function getRouteMetadata(target: ClassToken<unknown>): readonly RouteMetadata[] {
  const routes =
    (Reflect.getOwnMetadata(routeMetadataKey, target.prototype) as
      | readonly RouteMetadata[]
      | undefined) ?? [];
  return Object.freeze([...routes]);
}

/**
 * Reads the tokens a class constructs with: explicit `@Inject()` tokens by
 * parameter index, falling back to the reflected `design:paramtypes`.
 *
 * Explicit tokens share the reach of the reflected types — a subclass without
 * its own constructor runs the parent's — while own metadata still wins for a
 * subclass that declares its own constructor.
 *
 * @param target - The class to read.
 * @returns The frozen dependency list the container resolves.
 */
export function getConstructorDependencies(target: ClassToken<unknown>): readonly Token<unknown>[] {
  const reflected =
    (Reflect.getMetadata("design:paramtypes", target) as readonly unknown[] | undefined) ?? [];
  // Explicit tokens deliberately share the reach of `design:paramtypes`: a
  // subclass without its own constructor runs the parent's constructor, so it
  // must resolve the parent's declared tokens. Reading this map own-only would
  // keep the inherited reflected types but silently drop the inherited tokens.
  // Own metadata still wins, because it shadows the inherited entry.
  const explicit = Reflect.getMetadata(injectedTokensMetadataKey, target) as
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
