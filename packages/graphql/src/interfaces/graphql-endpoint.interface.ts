import type { createYoga } from "graphql-yoga";
import type { GraphQLSchema } from "graphql";

/**
 * The endpoint an application mounts GraphQL on, as the data a configuration
 * can carry.
 *
 * A configuration states the endpoint once, as `path`, and the module hands it
 * to yoga as `graphqlEndpoint`. A raw yoga server defaults that independently,
 * so an application that sets one and not the other gets an endpoint that
 * answers nothing. That footgun is what this package closes.
 */
export interface GraphQLConfiguration {
  /**
   * The path the GraphQL endpoint is served at.
   *
   * Must be a non-empty string beginning with `/`.
   */
  readonly path: string;
}

type YogaOptions = Omit<Parameters<typeof createYoga>[0], "graphqlEndpoint">;

/**
 * The schema half of yoga's own options.
 *
 * The same union yoga's own documentation states: a prebuilt `schema`, or
 * `typeDefs` plus `resolvers`, which the package compiles with yoga's own
 * `createSchema` before starting the server. Everything else — the context, the
 * plugins, the GraphiQL setting — travels to yoga untouched.
 *
 * The type is derived from the library's declaration rather than restated, so
 * it cannot drift from what yoga accepts.
 */
export type GraphQLSchemaOptions =
  | (YogaOptions & { readonly schema: GraphQLSchema; readonly typeDefs?: undefined })
  | (Omit<YogaOptions, "schema"> & {
      readonly schema?: undefined;
      readonly typeDefs: string | readonly unknown[];
      readonly resolvers?: Readonly<Record<string, unknown>>;
    });
