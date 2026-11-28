/**
 * `@aponiajs/graphql` — serve a GraphQL endpoint for an Aponia application.
 *
 * The package builds the endpoint from `graphql-yoga`'s own fetch handler and
 * contributes it as a neutral `HttpPolicy`, so one registration answers the same
 * way on every platform and no platform package is involved in the mount.
 *
 * **It is not a schema-first Aponia integration**: the schema is `typeDefs` plus
 * `resolvers`, or a prebuilt `GraphQLSchema`, and it is the application's, built
 * in the registration's factory. What this package adds is the module the
 * endpoint is declared in and a validated configuration the mount path is read
 * from — and, in particular, the path pair the handler needs set together, so a
 * non-default endpoint answers instead of returning `404`.
 *
 * The policy answers the declared path before routing, so no guard, interceptor,
 * or exception filter reaches it; a controller declaring the same
 * `(method, path)` shadows it without raising `DUPLICATE_ROUTE`. An application
 * that wants the raw plugin should install `@elysia/graphql-yoga` directly.
 */
export { GraphQLModule } from "./graphql.module.ts";
export type { GraphQLModuleOptions } from "./interfaces/graphql-module.interface.ts";
export type {
  GraphQLConfiguration,
  GraphQLSchemaOptions,
} from "./interfaces/graphql-endpoint.interface.ts";
