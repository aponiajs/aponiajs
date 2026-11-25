import type {
  ClassToken,
  ModuleAsyncOptions,
  ModuleImport,
  PipeType,
  Token,
} from "@aponiajs/common";

/** How the HTTP endpoint serves protocol revisions it does not own. */
export type McpHttpLegacy = "stateless" | "reject";

/** How a modern request's response is shaped. */
export type McpResponseMode = "auto" | "json" | "sse";

/** How the stdio connection serves the 2025 handshake. */
export type McpStdioLegacy = "serve" | "reject";

/** The HTTP endpoint's policy. */
export interface McpHttpOptions {
  /** How 2025-era requests are answered; defaults to `"stateless"`. */
  readonly legacy?: McpHttpLegacy;
  /** How a 2026-07-28 response is shaped; defaults to `"auto"`. */
  readonly responseMode?: McpResponseMode;
  /**
   * The browser origins allowed to reach the endpoint, by hostname.
   *
   * Defaults to `localhost`, `127.0.0.1`, and `[::1]`. `false` turns the
   * check off.
   */
  readonly allowedOrigins?: readonly string[] | false;
  /** The hostnames the `Host` header must name; omitted means no check. */
  readonly allowedHosts?: readonly string[];
  /** The largest request body the handler reads; defaults to 4 MiB. */
  readonly maxRequestBodySize?: number;
}

/** The stdio connection's policy. */
export interface McpStdioOptions {
  /** How the 2025 handshake is answered; defaults to `"serve"`. */
  readonly legacy?: McpStdioLegacy;
}

/** The server identity and transport policy a factory may build. */
export interface McpServerMetadata {
  readonly name: string;
  readonly version: string;
  readonly title?: string;
  readonly description?: string;
  readonly websiteUrl?: string;
  readonly icons?: readonly Readonly<Record<string, unknown>>[];
  readonly instructions?: string;
  readonly http?: McpHttpOptions;
  readonly stdio?: McpStdioOptions;
}

/** The top-level fields both registrations state. */
export interface McpModuleTopLevel {
  /** The endpoint path; defaults to `"/mcp"`. `false` disables HTTP. */
  readonly path?: string | false;
  /** The modules whose providers are searched; omitted means every module. */
  readonly include?: readonly ModuleImport[];
  /** Guards every MCP call runs, before the primitive's own. */
  readonly guards?: readonly ClassToken<unknown>[];
  /** Interceptors every MCP call runs, before the primitive's own. */
  readonly interceptors?: readonly ClassToken<unknown>[];
  /** Filters every MCP call consults, after the primitive's own. */
  readonly filters?: readonly ClassToken<unknown>[];
  /** Pipes every MCP call runs, before the primitive's own. */
  readonly pipes?: readonly PipeType[];
  /** The module identity; defaults to `"mcp"`. */
  readonly key?: string;
}

/** What `McpModule.forRoot` accepts. */
export interface McpModuleOptions extends McpModuleTopLevel, McpServerMetadata {}

/**
 * What `McpModule.forRootAsync` accepts.
 *
 * The factory, factory class, or existing provider builds the server metadata;
 * the top-level fields stay beside it, exactly as they do on `forRoot`.
 */
export type McpModuleAsyncOptions<TDependencies extends readonly Token<unknown>[] = readonly []> =
  ModuleAsyncOptions<McpServerMetadata> &
    McpModuleTopLevel & {
      /** The providers the factory receives. */
      readonly inject?: TDependencies;
    };

/** The options the runtime reads after defaults are applied. @internal */
export interface ResolvedMcpOptions {
  readonly name: string;
  readonly version: string;
  readonly title?: string;
  readonly description?: string;
  readonly websiteUrl?: string;
  readonly icons?: readonly Readonly<Record<string, unknown>>[];
  readonly instructions?: string;
  readonly path: string | false;
  readonly include: readonly ModuleImport[];
  readonly guards: readonly ClassToken<unknown>[];
  readonly interceptors: readonly ClassToken<unknown>[];
  readonly filters: readonly ClassToken<unknown>[];
  readonly pipes: readonly PipeType[];
  readonly legacy: McpHttpLegacy;
  readonly responseMode: McpResponseMode;
  readonly allowedOrigins: readonly string[] | false;
  readonly allowedHosts: readonly string[] | undefined;
  readonly maxRequestBodySize: number;
  readonly stdioLegacy: McpStdioLegacy;
  readonly key: string;
}
