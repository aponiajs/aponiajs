import type { yoga } from "@elysia/graphql-yoga";

/**
 * The endpoint an application mounts GraphQL on, as the data a configuration
 * can carry.
 *
 * The wrapped plugin needs the mount path twice: its own `path` moves the
 * Elysia route, and graphql-yoga's `graphqlEndpoint` decides which requests the
 * yoga handler answers. The two default independently — `path` to `/graphql`
 * and `graphqlEndpoint` to `/graphql` — so an application that sets one and not
 * the other gets a route that answers `404` for every request. That is the
 * footgun this package exists to close: a configuration states the endpoint
 * once, as `path`, and the module sets both from it.
 */
export interface GraphQLConfiguration {
  /**
   * The path the GraphQL endpoint is served at.
   *
   * Must be a non-empty string beginning with `/`. It is passed to the wrapped
   * plugin as both its own `path` and yoga's `graphqlEndpoint`, so the declared
   * path is the one that answers.
   */
  readonly path: string;
}

/**
 * The schema half of the wrapped plugin's own options.
 *
 * This is the plugin's `ElysiaYogaConfig` with the two fields this package
 * owns removed: `path`, which the validated configuration supplies, and
 * `graphqlEndpoint`, which the module sets to the same value. Everything else —
 * `typeDefs` and `resolvers`, or a prebuilt `schema`, plus the yoga server
 * options — travels to the plugin untouched.
 *
 * The type is derived from the plugin's own declaration rather than restated,
 * so it cannot drift from what the plugin accepts. The `Omit` is distributive
 * because the config is a union: one arm carries `typeDefs` + `resolvers` and
 * the other carries `schema`, and collapsing the union would erase which fields
 * a given arm requires.
 */
export type GraphQLSchemaOptions = DistributiveOmit<
  Parameters<typeof yoga>[0],
  "path" | "graphqlEndpoint"
>;

type DistributiveOmit<TValue, TKey extends PropertyKey> = TValue extends unknown
  ? Omit<TValue, TKey>
  : never;
