import {
  AponiaError,
  Module,
  provideFactory,
  type DynamicModule,
  type ModuleImport,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
import { buildMcpPlugin, readMcpPolicy } from "../policy/mcp-policy.ts";
import { McpSessionRegistry } from "../session/mcp-session-registry.ts";
import type { McpModuleOptions } from "./mcp-module.types.ts";

const defaultKey = "mcp";

/**
 * The module an application imports to serve a Model Context Protocol endpoint.
 *
 * ```ts
 * const mcp = McpModule.register({
 *   configuration: McpConfig,
 *   inject: [UsersService],
 *   useFactory: (users) => () => buildServer(users),
 *   authorize: (request) => verifyToken(request),
 * });
 *
 * @Module({ imports: [mcp] })
 * export class AppModule {}
 * ```
 *
 * The package owns no protocol code. The endpoint is the official
 * `@modelcontextprotocol/sdk` server and its web-standard streamable HTTP
 * transport; this module contributes the validated policy, the module graph
 * identity, and the request gate.
 *
 * `aponia build` cannot lower a registration: an `imports` entry that names a
 * `DynamicModule` is declined, and the application boots by lowering the root
 * from its decorators instead. The endpoint still mounts; what is given up is
 * the declared-graph boot.
 */
@Module({})
export class McpModule {
  /**
   * Builds the MCP endpoint module for one application.
   *
   * @param options - The configuration, injected factory, gate, session mode, and module key.
   * @returns A frozen registration the application's `imports` accepts.
   * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE` when the policy or the server factory is invalid.
   */
  static register<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    options: McpModuleOptions<TDependencies>,
  ): DynamicModule {
    const {
      configuration,
      source,
      key,
      imports,
      inject,
      useFactory,
      authorize,
      sessions,
      jsonResponse,
    } = options;
    const moduleKey = key ?? defaultKey;
    const injected = (inject ?? []) as TDependencies;
    const stateful = sessions === "stateful";

    const pluginModule = PluginModule.registerAsync({
      key: moduleKey,
      imports: imports ?? [],
      inject: [configuration, McpSessionRegistry, ...injected],
      useFactory: (
        value: unknown,
        registry: McpSessionRegistry,
        ...dependencies: TokenMap<TDependencies>
      ) => {
        const policy = readMcpPolicy(value, configuration, authorize);
        const serverFactory = useFactory(...dependencies);

        if (typeof serverFactory !== "function") {
          throw new AponiaError(
            "INVALID_CONFIGURATION_VALUE",
            `The MCP factory for "${configuration.description}" did not return a server factory.`,
            { configuration: configuration.description },
          );
        }

        return buildMcpPlugin({
          policy,
          serverFactory,
          authorize,
          registry,
          stateful,
          jsonResponse: jsonResponse ?? false,
        });
      },
    });

    return Object.freeze({
      ...pluginModule,
      imports: Object.freeze([...(imports ?? [])]) as readonly ModuleImport[],
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideFactory(McpSessionRegistry, [], () => new McpSessionRegistry()),
        ...(pluginModule.providers ?? []),
      ]),
      exports: Object.freeze([configuration]),
    });
  }
}
