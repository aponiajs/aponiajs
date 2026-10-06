import { JSONRPC_ERROR_CODES, MCP_PROTOCOL_VERSION } from "../protocol/protocol.constants.ts";
import type { McpServer } from "./mcp-server.ts";

/**
 * Creates an HTTP request handler for the MCP server.
 * Supports:
 * - GET: MCP discovery handshake (returns status, protocol, version).
 * - POST: Standard JSON-RPC 2.0 messages.
 */
export function createStatelessHttpHandler(server: McpServer) {
  return async function handleHttpRequest(
    request: Request,
    parsedBody?: unknown,
  ): Promise<Response> {
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "ready",
          protocol: "mcp",
          version: MCP_PROTOCOL_VERSION,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, POST" },
      });
    }

    let body = parsedBody;
    if (body === undefined || body === null) {
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: JSONRPC_ERROR_CODES.PARSE_ERROR,
              message: "Parse error",
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }
    }

    const responsePayload = await server.handleMessage(body);

    if (responsePayload === null) {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
