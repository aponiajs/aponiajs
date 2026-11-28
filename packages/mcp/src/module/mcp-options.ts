import { AponiaError } from "@aponiajs/common";
import type { ClassToken, ModuleImport, PipeType } from "@aponiajs/common";
import type {
  McpModuleTopLevel,
  McpServerMetadata,
  ResolvedMcpOptions,
} from "../interfaces/mcp-module.interface.ts";

const defaultAllowedOrigins = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);
const defaultMaxRequestBodySize = 4 * 1024 * 1024;

/** Applies the defaults and refuses an identity or path that cannot be served. */
export function resolveMcpOptions(
  metadata: McpServerMetadata,
  topLevel: McpModuleTopLevel = {},
): ResolvedMcpOptions {
  if (typeof metadata.name !== "string" || metadata.name.trim().length === 0) {
    throw new AponiaError("INVALID_MCP_OPTIONS", "An MCP server needs a non-empty name.", {
      field: "name",
    });
  }
  if (typeof metadata.version !== "string" || metadata.version.trim().length === 0) {
    throw new AponiaError("INVALID_MCP_OPTIONS", "An MCP server needs a non-empty version.", {
      field: "version",
    });
  }

  const path = topLevel.path === false ? false : normalizePath(topLevel.path);
  const http = metadata.http ?? {};
  const allowedOrigins = http.allowedOrigins ?? defaultAllowedOrigins;
  const maxRequestBodySize = http.maxRequestBodySize ?? defaultMaxRequestBodySize;

  if (typeof maxRequestBodySize !== "number" || maxRequestBodySize <= 0) {
    throw new AponiaError(
      "INVALID_MCP_OPTIONS",
      "An MCP endpoint needs a positive maxRequestBodySize.",
      { field: "http.maxRequestBodySize" },
    );
  }

  return Object.freeze({
    name: metadata.name,
    version: metadata.version,
    ...(metadata.title === undefined ? {} : { title: metadata.title }),
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    ...(metadata.websiteUrl === undefined ? {} : { websiteUrl: metadata.websiteUrl }),
    ...(metadata.icons === undefined ? {} : { icons: Object.freeze([...metadata.icons]) }),
    ...(metadata.instructions === undefined ? {} : { instructions: metadata.instructions }),
    path,
    include: Object.freeze([...(topLevel.include ?? [])]),
    guards: Object.freeze([...(topLevel.guards ?? [])]),
    interceptors: Object.freeze([...(topLevel.interceptors ?? [])]),
    filters: Object.freeze([...(topLevel.filters ?? [])]),
    pipes: Object.freeze([...(topLevel.pipes ?? [])]),
    legacy: http.legacy ?? "stateless",
    responseMode: http.responseMode ?? "auto",
    allowedOrigins: allowedOrigins === false ? false : Object.freeze([...allowedOrigins]),
    allowedHosts:
      http.allowedHosts === undefined ? undefined : Object.freeze([...http.allowedHosts]),
    maxRequestBodySize,
    stdioLegacy: metadata.stdio?.legacy ?? "serve",
    key: topLevel.key ?? "mcp",
  });
}

/** Reads a registry's top level apart from the metadata its factory builds. */
interface TopLevelSource {
  readonly path?: string | false;
  readonly include?: readonly ModuleImport[];
  readonly guards?: readonly ClassToken<unknown>[];
  readonly interceptors?: readonly ClassToken<unknown>[];
  readonly filters?: readonly ClassToken<unknown>[];
  readonly pipes?: readonly PipeType[];
  readonly key?: string;
}

export function topLevelOf(options: TopLevelSource): McpModuleTopLevel {
  return {
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.include === undefined ? {} : { include: options.include }),
    ...(options.guards === undefined ? {} : { guards: options.guards }),
    ...(options.interceptors === undefined ? {} : { interceptors: options.interceptors }),
    ...(options.filters === undefined ? {} : { filters: options.filters }),
    ...(options.pipes === undefined ? {} : { pipes: options.pipes }),
    ...(options.key === undefined ? {} : { key: options.key }),
  };
}

/**
 * Normalizes the endpoint path a registration states, for the controller the
 * module mounts. Returns `false` when HTTP is disabled.
 *
 * @internal
 */
export function resolveMcpHttpPath(path: string | false | undefined): string | false {
  return path === false ? false : normalizePath(path);
}

function normalizePath(path: string | undefined): string {
  const value = path ?? "/mcp";
  if (typeof value !== "string" || value.length === 0) {
    throw new AponiaError("INVALID_MCP_OPTIONS", "The MCP path must be a non-empty string.", {
      field: "path",
    });
  }
  return value.startsWith("/") ? value : `/${value}`;
}
