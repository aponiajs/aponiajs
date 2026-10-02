import {
  Module,
  type DynamicModule,
  type ModuleImport,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
import { buildGraphQLPlugin, readGraphQLMount } from "../endpoint/graphql-endpoint.ts";
import type { GraphQLConfiguration } from "../endpoint/graphql-endpoint.types.ts";
import type { GraphQLModuleOptions } from "./graphql-module.types.ts";

const defaultKey = "graphql";

/**
 * The module an application imports to serve a GraphQL endpoint.
 *
 * ```ts
 * const graphql = GraphQLModule.register({
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
 * The endpoint mounts through `use()`, outside the compiled route table, so **no
 * guard, interceptor, or exception filter reaches it**, and a controller that
 * declares the same `(method, path)` silently shadows it without raising
 * `DUPLICATE_ROUTE`. The README states both.
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
 * There is no plugin value to export beside this module, the way
 * `@aponiajs/devtools` exports its own. That package can, because its plugin is
 * built from options fixed in source; this one's endpoint path is a value the
 * container resolves, so the plugin exists only inside a boot. An application
 * that needs the route table untouched by a registration mounts the raw
 * `@elysia/graphql-yoga` plugin through `AponiaApplicationOptions.plugins`, and
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
   *     GraphQLModule.register({
   *       configuration: GraphQLConfig,
   *       inject: [UserService],
   *       useFactory: (users) => ({ typeDefs, resolvers: buildResolvers(users) }),
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static register<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    options: GraphQLModuleOptions<TDependencies>,
  ): DynamicModule {
    const { configuration, source, key, imports, inject, useFactory } = options;

    // The framework's own seam for a plugin built from an injected value. The
    // factory injects the configuration first, so a value the schema refuses
    // fails the boot in the provider pass, naming the configuration and its
    // issues, rather than reaching the plugin as a path nobody wrote.
    // `inject ?? []` is a union (`TDependencies | readonly []`) that would
    // infect the seam's tuple inference with a union, so it is settled here:
    // the seam then infers one tuple, and the factory below destructures it.
    const injected = (inject ?? []) as TDependencies;
    const pluginModule = PluginModule.registerAsync({
      key: key ?? defaultKey,
      imports: imports ?? [],
      inject: [configuration, ...injected],
      useFactory: (value: GraphQLConfiguration, ...dependencies: TokenMap<TDependencies>) => {
        const path = readGraphQLMount(value, configuration);

        // The schema is built here rather than at `register`, so the resolvers
        // it returns can close over the providers the application injected.
        return buildGraphQLPlugin(path, useFactory(...dependencies));
      },
    });

    return Object.freeze({
      ...pluginModule,
      // Restated rather than inherited so the registration owns the list it was
      // handed. The plugin factory injects from these exports, so the module
      // has to keep them.
      imports: Object.freeze([...(imports ?? [])]) as readonly ModuleImport[],
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        // Never empty in practice — the seam's own factory is always there — but
        // the type says a `DynamicModule` may declare no providers, and reading
        // it as one that always does is the assumption rather than the check.
        ...(pluginModule.providers ?? []),
      ]),
      // Exported so the application that mounted this module reads back the same
      // validated value the endpoint was built from, rather than declaring the
      // token a second time.
      exports: Object.freeze([configuration]),
    });
  }
}
