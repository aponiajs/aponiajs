import {
  Module,
  dynamicModule,
  type DynamicModule,
  type ModuleImport,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { createToken, provideFactory } from "@aponiajs/common";
import {
  provideConfiguration,
  provideHttpPolicyAsync,
  requirePlatformCapabilities,
  type HttpPolicy,
} from "@aponiajs/common";
import { buildGraphQLPolicy, readGraphQLMount } from "./endpoint/graphql-endpoint.ts";
import type { GraphQLConfiguration } from "./interfaces/graphql-endpoint.interface.ts";
import type { GraphQLModuleOptions } from "./interfaces/graphql-module.interface.ts";

const defaultKey = "graphql";

/** The endpoint one registration built. @internal */
const GRAPHQL_POLICY = createToken<HttpPolicy>("aponia.graphql.policy");

/**
 * The module an application imports to serve a GraphQL endpoint.
 *
 * ```ts
 * const graphql = GraphQLModule.forRoot({
 *   configuration: GraphQLConfig,
 *   inject: [UserService],
 *   useFactory: (users) => ({
 *     typeDefs: `type Query { users: [String] }`,
 *     resolvers: { Query: { users: () => users.all() } },
 *   }),
 * });
 *
 * @Module({ imports: [graphql] })
 * export class AppModule {}
 * ```
 *
 * The endpoint is a neutral `HttpPolicy`: it answers the declared path before
 * routing on every platform, so **no guard, interceptor, or exception filter
 * reaches it**, and a controller that declares the same `(method, path)`
 * silently shadows it without raising `DUPLICATE_ROUTE`. The README states both.
 *
 * `aponia build` cannot read a registration: it lowers a module only when every
 * `imports` entry names an entry that resolves to a `@Module()` class in the
 * project's own source, and a `DynamicModule` is not one — held in a `const`,
 * the module that imports it is declined and the committed descriptor artifact
 * holds nothing for it. The application is whole anyway: a boot is handed an
 * artifact holding no declaration for the root module it named, and lowers that
 * root from its decorators instead. What a decline costs is the lowering, not
 * the endpoint.
 *
 * There is no plugin value to export beside this module: the endpoint path is a
 * value the container resolves, so the policy exists only inside a boot. An
 * application that needs the mount built by hand installs
 * `@elysia/graphql-yoga` and hands it to `AponiaApplicationOptions.plugins`, and
 * gives up the module and its validated path to do it.
 */
@Module({})
export class GraphQLModule {
  /**
   * Builds the GraphQL module for one application.
   *
   * ```ts
   * @Module({
   *   imports: [
   *     GraphQLModule.forRoot({
   *       configuration: GraphQLConfig,
   *       inject: [UserService],
   *       useFactory: (users) => ({ typeDefs, resolvers: buildResolvers(users) }),
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   *
   * @param options - The configuration, injected factory, literal source, and module key.
   * @returns A frozen registration the application's `imports` accepts.
   */
  static forRoot<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    options: GraphQLModuleOptions<TDependencies>,
  ): DynamicModule {
    const { configuration, source, key, imports, inject, useFactory } = options;

    // The framework's own seam for a policy built from an injected value. The
    // factory injects the configuration first, so a value the schema refuses
    // fails the boot in the provider pass, naming the configuration and its
    // issues, rather than reaching the policy as a path nobody wrote.
    // `inject ?? []` is a union (`TDependencies | readonly []`) that would
    // infect the seam's tuple inference with a union, so it is settled here:
    // the seam then infers one tuple, and the factory below destructures it.
    const injected = (inject ?? []) as TDependencies;

    return dynamicModule({
      module: GraphQLModule,
      id: `GraphQLModule[${key ?? defaultKey}]`,
      instanceId: Symbol.for(`aponia.graphql:${key ?? defaultKey}`),
      // Restated rather than inherited so the registration owns the list it was
      // handed. The policy factory injects from these exports, so the module
      // has to keep them.
      imports: Object.freeze([...(imports ?? [])]) as readonly ModuleImport[],
      providers: [
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideFactory(
          GRAPHQL_POLICY,
          [configuration, ...injected],
          (value: GraphQLConfiguration, ...dependencies: unknown[]) =>
            // The schema is built here rather than at `forRoot`, so the resolvers
            // it returns can close over the providers the application injected.
            buildGraphQLPolicy(
              readGraphQLMount(value, configuration),
              useFactory(...(dependencies as TokenMap<TDependencies>)),
            ),
        ),
        provideHttpPolicyAsync([GRAPHQL_POLICY], (policy) => policy),
        requirePlatformCapabilities("graphql", ["http", "streaming"]),
      ],
      // Exported so the application that mounted this module reads back the same
      // validated value the endpoint was built from, rather than declaring the
      // token a second time.
      exports: [configuration],
    });
  }

  /**
   * Builds the GraphQL module for one application.
   *
   * @deprecated Use {@link GraphQLModule.forRoot}; retained for the beta line.
   */
  static register<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    options: GraphQLModuleOptions<TDependencies>,
  ): DynamicModule {
    return GraphQLModule.forRoot(options);
  }
}
