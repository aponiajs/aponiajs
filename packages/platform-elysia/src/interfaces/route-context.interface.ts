import type {
  RouteSchema as AponiaRouteSchema,
  RouteValidatorInput,
  ValidationModelClass,
} from "@aponiajs/common";
import type { AnyElysia, Context, InputSchema, UnwrapRoute } from "elysia";
import type { SingletonBase } from "elysia/types";

/**
 * One plugin a handler reads from: a native Elysia instance, or the module
 * import `definePlugin` produces for it.
 */
export type PluginSource = AnyElysia | { readonly plugin: AnyElysia };

/**
 * One plugin, or every plugin whose types a handler depends on.
 */
export type PluginTypes = PluginSource | readonly PluginSource[];

type ResolvePlugin<TSource> = TSource extends { readonly plugin: infer TPlugin extends AnyElysia }
  ? TPlugin
  : TSource;

type PluginUnion<TPlugins extends PluginTypes> = ResolvePlugin<
  TPlugins extends readonly (infer TSource)[] ? TSource : TPlugins
>;

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type MergeRecords<TUnion> =
  UnionToIntersection<TUnion> extends infer TMerged extends Record<string, unknown> ? TMerged : {};

/**
 * The singleton a controller sees once the plugins are mounted. `use()` merges
 * a plugin's global `~Singleton` into its parent, and its `scoped` `~Ephemeral`
 * derives and resolves reach the routes mounted alongside it, so both are part
 * of the context. Plugin-local derives stay inside the plugin and are excluded.
 */
type MountedSingleton<TPlugins extends PluginTypes> = {
  decorator: MergeRecords<PluginUnion<TPlugins>["~Singleton"]["decorator"]>;
  store: MergeRecords<PluginUnion<TPlugins>["~Singleton"]["store"]>;
  derive: MergeRecords<
    PluginUnion<TPlugins>["~Singleton"]["derive"] | PluginUnion<TPlugins>["~Ephemeral"]["derive"]
  >;
  resolve: MergeRecords<
    PluginUnion<TPlugins>["~Singleton"]["resolve"] | PluginUnion<TPlugins>["~Ephemeral"]["resolve"]
  >;
} extends infer TSingleton extends SingletonBase
  ? TSingleton
  : never;

/**
 * A type-only Standard Schema projection lets Elysia infer a validation
 * model's instance shape without exposing or reconstructing its runtime
 * validator. Runtime lowering remains owned by the route compiler.
 *
 * Both directions carry the instance type because Elysia reads a validator in
 * both directions: a request slot through the Standard Schema's `output`, which
 * is the value validation produces, and a response slot through its `input`,
 * which is the value a handler hands back to be encoded. A model class
 * describes one instance on both sides, so leaving `input` as `unknown` — as a
 * request-only projection may — reads a model-backed response member back as
 * `unknown` and collapses `ResponseStatus` to a helper that accepts no status.
 */
interface ValidationModelSchema<TOutput> {
  readonly "~standard": {
    readonly types: {
      readonly input: TOutput;
      readonly output: TOutput;
    };
  };
}

type LowerValidationModel<TValidator> =
  TValidator extends ValidationModelClass<infer TInstance>
    ? ValidationModelSchema<TInstance>
    : TValidator;

type LowerResponseSchema<TResponse> =
  TResponse extends ValidationModelClass<infer TInstance>
    ? ValidationModelSchema<TInstance>
    : TResponse extends Readonly<Record<number, RouteValidatorInput>>
      ? {
          readonly [TStatus in keyof TResponse]: LowerValidationModel<TResponse[TStatus]>;
        }
      : TResponse;

type LowerAponiaRouteSchema<TSchema extends AponiaRouteSchema> = {
  readonly [TSlot in keyof TSchema]: TSlot extends "response"
    ? LowerResponseSchema<TSchema[TSlot]>
    : LowerValidationModel<TSchema[TSlot]>;
};

type ResolveRouteInputSchema<TSchema> = TSchema extends InputSchema
  ? TSchema
  : TSchema extends AponiaRouteSchema
    ? LowerAponiaRouteSchema<TSchema> extends infer TLowered extends InputSchema
      ? TLowered
      : {}
    : {};

/**
 * The native Elysia request context for a declared route schema. Handlers that
 * take the whole context — through `@Context()` or a single unannotated parameter —
 * keep `status`, `set`, `cookie`, `store`, `redirect`, and plugin decorators
 * fully typed.
 *
 * Compiling a decorated controller erases the plugin instances a module
 * imports, so name the plugins a handler reads from. The first argument takes
 * either a route schema or the plugins, so a handler without a schema never
 * writes an empty one:
 *
 * ```ts
 * read(@Context() context: HandlerContext<typeof clock>) {}
 * read(@Context() context: HandlerContext<[typeof clock, typeof cache]>) {}
 * create(@Context() context: HandlerContext<typeof createUser, typeof clock>) {}
 * ```
 *
 * A plugin exported through `definePlugin` alongside a same-named type
 * drops the `typeof`, which reads best under a short import alias:
 *
 * ```ts
 * import { type HandlerContext as e } from "@aponiajs/platform-elysia";
 *
 * read(@Context() context: e<clock>) {}
 * ```
 *
 * An application that always mounts the same plugins declares the pairing once
 * and keeps its handlers short:
 *
 * ```ts
 * export type AppContext<TSchema extends RouteInputSchema = {}> =
 *   HandlerContext<TSchema, [typeof clock, typeof cache]>;
 * ```
 */
export type HandlerContext<
  TSchemaOrPlugins extends RouteInputSchema | PluginTypes = {},
  TPlugins extends PluginTypes = never,
> = TSchemaOrPlugins extends PluginTypes
  ? Context<UnwrapRoute<{}, {}, string>, MountedSingleton<TSchemaOrPlugins>>
  : Context<
      UnwrapRoute<ResolveRouteInputSchema<TSchemaOrPlugins>, {}, string>,
      MountedSingleton<TPlugins>
    >;

/**
 * The exact mutable response settings exposed as `context.set`. Prefixed with
 * `Elysia` because it is Elysia's own `set` object rather than an Aponia
 * abstraction: `@aponiajs/common` exports a `ResponseSettings` decorator, so a
 * handler annotating a parameter with both would otherwise have to alias one.
 */
export type ElysiaResponseSettings = HandlerContext["set"];

/** The exact application state contributed by one plugin or a plugin tuple. */
export type AppState<TPlugins extends PluginTypes = never> = [TPlugins] extends [never]
  ? HandlerContext["store"]
  : HandlerContext<TPlugins>["store"];

/** The response-schema-aware status helper exposed as `context.status`. */
export type ResponseStatus<TSchema extends RouteInputSchema = {}> =
  HandlerContext<TSchema>["status"];

/**
 * A raw Elysia input schema or an Aponia route schema containing validation
 * model classes. Re-exported so an application can write one context alias
 * without importing either framework's internal schema types.
 */
export type RouteInputSchema = InputSchema | AponiaRouteSchema;
