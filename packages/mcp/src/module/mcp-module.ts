import {
  Module,
  createToken,
  dynamicModule,
  provideFactory,
  provideValue,
  type DynamicModule,
  type Provider,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { providePlatformModule } from "@aponiajs/platform-core";
import {
  MCP_ELYSIA_ADAPTER,
  MCP_H3_ADAPTER,
  MCP_HONO_ADAPTER,
  elysiaAdapter,
  h3Adapter,
  honoAdapter,
} from "../adapters/mcp.adapters.ts";
import { resolveMcpOptions, topLevelOf } from "./mcp-options.ts";
import type {
  McpModuleAsyncOptions,
  McpModuleOptions,
  ResolvedMcpOptions,
} from "./mcp-module.types.ts";

/** The resolved options the adapters read. @internal */
export const MCP_OPTIONS = createToken<ResolvedMcpOptions>("aponia.mcp.options");

/**
 * The module an application imports to serve a Model Context Protocol endpoint.
 *
 * ```ts
 * @Module({
 *   imports: [McpModule.forRoot({ name: "cat-store", version: "1.0.0" })],
 *   providers: [OrdersTools],
 * })
 * export class AppModule {}
 * ```
 *
 * Tools, resources, and prompts are methods of providers, decorated with
 * `@Tool()`, `@Resource()`, `@ResourceTemplate()`, and `@Prompt()`. The module
 * discovers them at mount time and builds one SDK server per request.
 */
@Module({})
export class McpModule {
  /**
   * Registers the endpoint with literal options.
   *
   * @param options - The server identity, transports, and enhancers.
   * @returns The dynamic module an application imports.
   */
  static forRoot(options: McpModuleOptions): DynamicModule {
    const resolved = resolveMcpOptions(options, topLevelOf(options));

    return dynamicModule({
      module: McpModule,
      id: `McpModule[${resolved.key}]`,
      instanceId: Symbol.for(`aponia.plugin.mcp:${resolved.key}`),
      providers: [
        provideValue(MCP_OPTIONS, resolved),
        ...adapterProviders(),
        platformProvider(resolved.key),
      ],
      exports: [],
    });
  }

  /**
   * Registers the endpoint with metadata a factory builds.
   *
   * The factory runs synchronously during the provider pass, matching the
   * container's registration contract in this release.
   *
   * @param options - The imports, injected tokens, factory, and top-level fields.
   * @returns The dynamic module an application imports.
   */
  static forRootAsync<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    options: McpModuleAsyncOptions<TDependencies>,
  ): DynamicModule {
    const top = topLevelOf(options);
    const key = top.key ?? "mcp";
    const injected = (options.inject ?? []) as TDependencies;

    return dynamicModule({
      module: McpModule,
      id: `McpModule[${key}]`,
      instanceId: Symbol.for(`aponia.plugin.mcp:${key}`),
      imports: [...(options.imports ?? [])],
      providers: [
        provideFactory(MCP_OPTIONS, injected, (...dependencies: TokenMap<TDependencies>) =>
          resolveMcpOptions(options.useFactory(...dependencies), top),
        ),
        ...adapterProviders(),
        platformProvider(key),
      ],
      exports: [],
    });
  }
}

function adapterProviders(): readonly Provider[] {
  return [
    provideFactory(MCP_ELYSIA_ADAPTER, [MCP_OPTIONS], (options: ResolvedMcpOptions) =>
      elysiaAdapter(options),
    ),
    provideFactory(MCP_HONO_ADAPTER, [MCP_OPTIONS], (options: ResolvedMcpOptions) =>
      honoAdapter(options),
    ),
    provideFactory(MCP_H3_ADAPTER, [MCP_OPTIONS], (options: ResolvedMcpOptions) =>
      h3Adapter(options),
    ),
  ];
}

function platformProvider(key: string): Provider {
  return providePlatformModule({
    key,
    platforms: ["elysia", "hono", "h3"],
    adapters: {
      elysia: MCP_ELYSIA_ADAPTER,
      hono: MCP_HONO_ADAPTER,
      h3: MCP_H3_ADAPTER,
    },
  });
}
