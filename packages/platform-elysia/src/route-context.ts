import type { AnyElysia, Context, InputSchema, SingletonBase, UnwrapRoute } from "elysia";

/**
 * One native Elysia plugin, or every plugin whose types a handler depends on.
 */
export type ElysiaPluginTypes = AnyElysia | readonly AnyElysia[];

type PluginUnion<TPlugins extends ElysiaPluginTypes> = TPlugins extends readonly (infer TPlugin)[]
  ? TPlugin
  : TPlugins;

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
 * imports, so name them in the second type argument to type what they add:
 *
 * ```ts
 * create(@Ctx() context: ElysiaRouteContext<typeof createUser, typeof jwtPlugin>) {}
 * create(@Ctx() context: ElysiaRouteContext<{}, [typeof jwtPlugin, typeof cachePlugin]>) {}
 * ```
 */
export type ElysiaRouteContext<
  TSchema extends InputSchema = {},
  TPlugins extends ElysiaPluginTypes = never,
> = Context<UnwrapRoute<TSchema, {}, string>, MountedSingleton<TPlugins>>;
