import type { ConfigurationToken, ModuleImport, Token, TokenMap } from "@aponiajs/common";
import type {
  GraphQLConfiguration,
  GraphQLSchemaOptions,
} from "../endpoint/graphql-endpoint.types.ts";

/**
 * How an application declares its GraphQL endpoint in its `imports`.
 *
 * The endpoint arrives through `configuration`, which is the framework's seam
 * for a value that must be validated before it is used, and the schema arrives
 * through `useFactory`, which is where dependency injection reaches a resolver.
 * A resolver built inside the factory can close over any provider named in
 * `inject`, so a query is served by a service the container constructed rather
 * than by a module-level constant.
 *
 * The schema itself is deliberately **not** an Aponia route schema or a
 * `@Validation()` model. A GraphQL schema is `typeDefs` plus `resolvers`, or a
 * prebuilt `GraphQLSchema`, and every one of those is a live value the wrapped
 * plugin owns; `GraphQLSchemaOptions` is the plugin's own options type with the
 * two fields this package sets removed.
 */
export interface GraphQLModuleOptions<
  TDependencies extends readonly Token<unknown>[] = readonly [],
> {
  /**
   * The declaration whose value states the endpoint path.
   *
   * The module provides this token itself and exports it, so the application
   * can read the same validated value back. The value carries one field,
   * `path`, and the module sets the wrapped plugin's `path` and yoga's
   * `graphqlEndpoint` from it: a non-default endpoint is declared once, and the
   * `404` a raw plugin answers when only one of the two is set cannot happen
   * through this package.
   */
  readonly configuration: ConfigurationToken<GraphQLConfiguration>;
  /**
   * Modules whose exports the factory may inject.
   *
   * A provider the factory names in `inject` is resolved against the module
   * that declares the plugin, so a service the application wants a resolver to
   * use has to be exported by a module listed here.
   */
  readonly imports?: readonly ModuleImport[];
  /**
   * The providers the factory receives, resolved by the container.
   *
   * Omitted means the factory receives nothing beyond the validated
   * configuration, which is how a schema fixed in source is declared.
   */
  readonly inject?: TDependencies;
  /**
   * Builds the schema half of the plugin's options from the injected
   * providers.
   *
   * Returns either `typeDefs` and `resolvers` or a prebuilt `schema`, exactly
   * as the wrapped plugin accepts them. The function runs once per boot, after
   * the providers it names exist, and its result is handed to the plugin
   * unchanged.
   */
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => GraphQLSchemaOptions;
  /**
   * The record the configuration's schema validates, instead of `process.env`.
   *
   * Present for the same reason `provideConfiguration` accepts it: a literal is
   * how a test validates without mutating the process.
   */
  readonly source?: Readonly<Record<string, unknown>>;
  /**
   * The module's stable identity, which is what the graph keys the registration
   * by.
   *
   * Two registrations under one key are one module identity, which the graph
   * refuses as a duplicate rather than mounting one and dropping the other.
   * Defaults to `"graphql"`.
   *
   * A distinct key does not buy a second endpoint. The module provides and
   * exports the same configuration token whichever key it is registered under,
   * so a root that imports two registrations resolves that token from two
   * imports that disagree and `application.get` raises `AMBIGUOUS_PROVIDER`.
   * One registration per application is the supported shape.
   */
  readonly key?: string;
}
