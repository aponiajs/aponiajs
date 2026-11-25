import {
  Module,
  createToken,
  dynamicModule,
  moduleOptionsProviders,
  provideFactory,
  provideValue,
  type DynamicModule,
  type ModuleAsyncOptions,
  type Provider,
  type Token,
} from "@aponiajs/common";
import {
  APPLICATION_CONTAINER,
  requirePlatformCapabilities,
  type ApplicationContainerRef,
} from "@aponiajs/platform-core";
import {
  MCP_RUNTIME,
  McpRuntimeShutdown,
  createMcpRuntimeFromContainer,
  type McpRuntime,
} from "../transport/mcp-runtime.ts";
import { createMcpController } from "./mcp.controller.ts";
import { resolveMcpHttpPath, resolveMcpOptions, topLevelOf } from "./mcp-options.ts";
import type {
  McpModuleAsyncOptions,
  McpModuleOptions,
  McpServerMetadata,
  ResolvedMcpOptions,
} from "../interfaces/mcp-module.interface.ts";

/** The resolved options the controller and runtime read. @internal */
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
 * discovers them at boot and serves one SDK server per request through a
 * controller, so the endpoint runs on every platform. `listenMcpStdio` reads the
 * same runtime from the application's container.
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
    return registration(
      [provideValue(MCP_OPTIONS, resolved)],
      resolveMcpHttpPath(options.path),
      resolved.key,
    );
  }

  /**
   * Registers the endpoint with metadata a factory builds.
   *
   * The factory may return the metadata or a Promise for it. The boot awaits
   * the result before the runtime reads the options token. `useClass` and
   * `useExisting` name an options factory instead of a function. The HTTP path
   * is read from the registration's top level, because a route path is fixed
   * while the module is registered.
   *
   * @param options - The imports, injected tokens, factory, and top-level fields.
   * @returns The dynamic module an application imports.
   */
  static forRootAsync<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    options: McpModuleAsyncOptions<TDependencies>,
  ): DynamicModule {
    const top = topLevelOf(options);
    const key = top.key ?? "mcp";
    return registration(
      moduleOptionsProviders(
        MCP_OPTIONS,
        options as ModuleAsyncOptions<McpServerMetadata>,
        (metadata) => resolveMcpOptions(metadata, top),
      ),
      resolveMcpHttpPath(top.path),
      key,
      options.imports,
      options.extraProviders,
    );
  }
}

function registration(
  optionsProviders: readonly Provider[],
  path: string | false,
  key: string,
  imports: readonly import("@aponiajs/common").ModuleImport[] = [],
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return dynamicModule({
    module: McpModule,
    id: `McpModule[${key}]`,
    instanceId: Symbol.for(`aponia.plugin.mcp:${key}`),
    imports,
    providers: [
      ...optionsProviders,
      provideFactory(
        MCP_RUNTIME,
        [MCP_OPTIONS, APPLICATION_CONTAINER],
        (options: ResolvedMcpOptions, container: ApplicationContainerRef) =>
          createMcpRuntimeFromContainer(container, options),
      ),
      provideFactory(
        McpRuntimeShutdown,
        [MCP_RUNTIME],
        (runtime: McpRuntime) => new McpRuntimeShutdown(runtime),
      ),
      ...(path === false ? [] : [requirePlatformCapabilities("mcp", ["http", "streaming"])]),
      ...extraProviders,
    ],
    controllers: path === false ? [] : [createMcpController(path)],
    exports: [MCP_RUNTIME],
  });
}
