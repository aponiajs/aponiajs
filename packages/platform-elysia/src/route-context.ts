import type { AnyElysia, Context, InputSchema, SingletonBase, UnwrapRoute } from "elysia";

/**
 * One plugin a handler reads from: a native Elysia instance, or the module
 * import `defineElysiaPlugin` produces for it.
 */
export type ElysiaPluginSource = AnyElysia | { readonly plugin: AnyElysia };

/**
 * One plugin, or every plugin whose types a handler depends on.
 */
export type ElysiaPluginTypes = ElysiaPluginSource | readonly ElysiaPluginSource[];

type ResolvePlugin<TSource> = TSource extends { readonly plugin: infer TPlugin extends AnyElysia }
  ? TPlugin
  : TSource;

type PluginUnion<TPlugins extends ElysiaPluginTypes> = ResolvePlugin<
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
type MountedSingleton<TPlugins extends ElysiaPluginTypes> = {
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
 * The native Elysia request context for a declared route schema. Handlers that
 * take the whole context — through `@Ctx()` or a single unannotated parameter —
 * keep `status`, `set`, `cookie`, `store`, `redirect`, and plugin decorators
 * fully typed.
 *
 * Compiling a decorated controller erases the plugin instances a module
 * imports, so name the plugins a handler reads from. The first argument takes
 * either a route schema or the plugins, so a handler without a schema never
 * writes an empty one:
 *
 * ```ts
 * read(@Ctx() context: ElysiaRouteContext<typeof clock>) {}
 * read(@Ctx() context: ElysiaRouteContext<[typeof clock, typeof cache]>) {}
 * create(@Ctx() context: ElysiaRouteContext<typeof createUser, typeof clock>) {}
 * ```
 *
 * A plugin exported through `defineElysiaPlugin` alongside a same-named type
 * drops the `typeof`, which reads best under a short import alias:
 *
 * ```ts
 * import { type ElysiaRouteContext as e } from "@aponiajs/platform-elysia";
 *
 * read(@Ctx() context: e<clock>) {}
 * ```
 *
 * An application that always mounts the same plugins declares the pairing once
 * and keeps its handlers short:
 *
 * ```ts
 * export type AppContext<TSchema extends ElysiaInputSchema = {}> =
 *   ElysiaRouteContext<TSchema, [typeof clock, typeof cache]>;
 * ```
 */
export type ElysiaRouteContext<
  TSchemaOrPlugins extends InputSchema | ElysiaPluginTypes = {},
  TPlugins extends ElysiaPluginTypes = never,
> = TSchemaOrPlugins extends ElysiaPluginTypes
  ? Context<UnwrapRoute<{}, {}, string>, MountedSingleton<TSchemaOrPlugins>>
  : Context<
      UnwrapRoute<TSchemaOrPlugins extends InputSchema ? TSchemaOrPlugins : {}, {}, string>,
      MountedSingleton<TPlugins>
    >;

/**
 * Elysia's own route schema shape, re-exported so an application can write its
 * own context alias without importing from `elysia` directly.
 */
export type ElysiaInputSchema = InputSchema;
