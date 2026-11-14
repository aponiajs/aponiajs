/**
 * `@aponiajs/graphql` — serve a GraphQL endpoint for an Aponia application.
 *
 * The package wraps
 * [`@elysia/graphql-yoga`](https://www.npmjs.com/package/@elysia/graphql-yoga),
 * which wraps [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server). **It is
 * not a schema-first Aponia integration**: the schema is `typeDefs` plus
 * `resolvers`, or a prebuilt `GraphQLSchema`, and it is the application's, built
 * in the module's factory. What this package contributes is a module the plugin
 * is declared in and a validated configuration the mount path is read from —
 * and, in particular, the two fields the raw plugin needs set together, so a
 * non-default endpoint answers instead of returning `404`.
 *
 * The endpoint mounts through `use()`, outside the compiled route table, so no
 * guard, interceptor, or exception filter reaches it. An application that wants
 * the raw plugin should install `@elysia/graphql-yoga` directly.
 */
export { GraphQLModule } from "./module/graphql-module.ts";
export type { GraphQLModuleOptions } from "./module/graphql-module.types.ts";
export type {
  GraphQLConfiguration,
  GraphQLSchemaOptions,
} from "./endpoint/graphql-endpoint.types.ts";
