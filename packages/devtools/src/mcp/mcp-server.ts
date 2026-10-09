import type { Elysia } from "elysia";
import type { LoggerService } from "@aponiajs/common";
import { McpServer, createStatelessHttpHandler, defineMcpTool } from "@aponiajs/mcp";
import type { AponiaApplicationDiagnostics } from "@aponiajs/platform-elysia";
import type { LogStream } from "../logging/log-tap.ts";
import type { RequestBuffer } from "../requests/request-buffer.types.ts";
import { buildGraphPayload } from "../endpoints/graph.ts";
import { buildFlowPayload } from "../endpoints/flow.ts";
import { resolveSourceCode } from "../source/source-resolver.ts";

/** Path the MCP endpoint is mounted under. */
export const devtoolsMcpPath = "/mcp";

/**
 * Context dependencies provided to the MCP server during tool execution.
 */
export interface McpServerContext {
  readonly diagnostics: AponiaApplicationDiagnostics | undefined;
  readonly application: Elysia | undefined;
  readonly logs: LogStream | undefined;
  readonly requests: RequestBuffer | undefined;
  readonly logger: LoggerService;
}

/**
 * Creates and registers the official Model Context Protocol (MCP) server.
 */
export function createDevtoolsMcpServer(context: McpServerContext): McpServer {
  const server = new McpServer({
    name: "aponia-devtools",
    version: "1.0.0",
  });

  server.registerTool(
    defineMcpTool<{ target: string }>({
      name: "get_source_code",
      description:
        "Retrieve the source code implementation of a controller, service, handler method, or enhancer in the running application.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "Target identifier (e.g. 'UsersService', 'UsersController.findOne', or 'AuthGuard')",
          },
        },
        required: ["target"],
      },
      handler: async ({ target }) => {
        const result = await resolveSourceCode(target);
        if (!result) {
          return {
            isError: true,
            content: [
              { type: "text", text: `Source code for target "${target}" could not be found.` },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    }),
  );

  server.registerTool(
    defineMcpTool({
      name: "inspect_application_graph",
      description:
        "Inspect the complete Dependency Injection graph of the application, including modules, controllers, providers, scopes, and directed dependencies.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const graph = buildGraphPayload(context.diagnostics, { view: "graph" });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                graph ?? {
                  nodes: [],
                  edges: [],
                  diagnostics: { unusedProviders: [], circularDependencies: [] },
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    }),
  );

  server.registerTool(
    defineMcpTool<{ method?: string; path?: string }>({
      name: "inspect_route_pipeline",
      description:
        "Inspect the execution pipeline of a route, showing exact execution order from middleware, guards, interceptors, pipes, handler, to exception filters.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", description: "HTTP method (e.g. GET, POST)" },
          path: { type: "string", description: "Route path pattern (e.g. /users/:id)" },
        },
      },
      handler: async ({ method, path }) => {
        if (!context.application) {
          return {
            isError: true,
            content: [{ type: "text", text: "Application instance is not available." }],
          };
        }
        const flow = buildFlowPayload(context.application, context.diagnostics);
        if (method && path) {
          const routeId = `${method.toUpperCase()} ${path}`;
          const matched = flow.routes.find((r) => r.id === routeId);
          if (matched) {
            return {
              content: [
                { type: "text", text: JSON.stringify({ routes: [matched], ...matched }, null, 2) },
              ],
            };
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify(flow, null, 2) }],
        };
      },
    }),
  );

  server.registerTool(
    defineMcpTool<{ key?: string }>({
      name: "inspect_store_state",
      description:
        "Inspect current in-memory snapshots of the global Elysia store and request context state.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Optional store key to inspect" },
        },
      },
      handler: async ({ key }) => {
        if (!context.application) {
          return {
            isError: true,
            content: [{ type: "text", text: "Application instance is not available." }],
          };
        }
        const rawStore = (context.application as any).store ?? {};
        const safeStore: Record<string, unknown> = {};
        for (const k of Object.keys(rawStore)) {
          if (!k.startsWith("_") && !k.includes("aponia")) {
            safeStore[k] = rawStore[k];
          }
        }
        const result = key ? { [key]: safeStore[key] } : safeStore;
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    }),
  );

  server.registerTool(
    defineMcpTool<{ status?: number; limit?: number; onlyErrors?: boolean }>({
      name: "query_recent_requests",
      description:
        "Query recent HTTP requests processed by the application, including status, duration, errors, and state snapshots.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "number", description: "Filter by HTTP status code" },
          limit: { type: "number", description: "Maximum number of records to return" },
          onlyErrors: { type: "boolean", description: "Filter only failing requests" },
        },
      },
      handler: async ({ status, limit, onlyErrors }) => {
        if (!context.requests) {
          return {
            content: [{ type: "text", text: "[]" }],
          };
        }
        let entries = context.requests.since(0).entries;
        if (status) {
          entries = entries.filter((e) => e.status === status);
        }
        if (onlyErrors) {
          entries = entries.filter((e) => (e.status ?? 0) >= 400);
        }
        const sliced = entries.slice(-(limit ?? 20));
        return {
          content: [{ type: "text", text: JSON.stringify(sliced, null, 2) }],
        };
      },
    }),
  );

  server.registerTool(
    defineMcpTool<{ level?: string; since?: number }>({
      name: "read_application_logs",
      description: "Read recent application logs emitted through the LoggerService.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["error", "warn", "info", "debug"],
            description: "Filter by log level",
          },
          since: { type: "number", description: "Cursor offset to read logs since" },
        },
      },
      handler: async ({ level, since }) => {
        if (!context.logs) {
          return {
            content: [{ type: "text", text: "[]" }],
          };
        }
        let entries = context.logs.buffer.since(since ?? 0).entries;
        if (level) {
          entries = entries.filter((e) => e.level === level);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        };
      },
    }),
  );

  return server;
}

/**
 * Handles incoming HTTP requests for the MCP protocol endpoint.
 */
export async function handleMcpRequest(
  request: Request,
  context: McpServerContext,
  parsedBody?: unknown,
): Promise<Response> {
  const server = createDevtoolsMcpServer(context);
  const handler = createStatelessHttpHandler(server);
  return handler(request, parsedBody);
}
