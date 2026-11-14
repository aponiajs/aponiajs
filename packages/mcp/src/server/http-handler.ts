import {
  JSONRPC_ERROR_CODES,
  MCP_PROTOCOL_META_KEY,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION_HEADER,
} from "../protocol/protocol.constants.ts";
import type { McpServer } from "./mcp-server.ts";

/**
 * Creates an HTTP request handler for the MCP server.
 *
 * - `GET` answers a readiness document naming the protocol and every version
 *   the server supports.
 * - `POST` carries one JSON-RPC message. A stateless request states its
 *   version in the `Mcp-Protocol-Version` header and, when it also states one
 *   in `params._meta`, both must agree.
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
          protocolVersions: server.protocolVersions,
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

    const headerVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER);
    if (headerVersion !== null && !server.protocolVersions.includes(headerVersion)) {
      return protocolError(`Unsupported protocol version ${headerVersion}`);
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

    const metaVersion = protocolVersionInBody(body);
    if (headerVersion !== null && metaVersion !== undefined && metaVersion !== headerVersion) {
      return protocolError(
        `The request states protocol version ${metaVersion} in its meta and ${headerVersion} in its header`,
      );
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

function protocolError(message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

function protocolVersionInBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const params = (body as { readonly params?: unknown }).params;
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const meta = (params as { readonly _meta?: unknown })._meta;
  if (typeof meta !== "object" || meta === null) {
    return undefined;
  }
  const version = (meta as Record<string, unknown>)[MCP_PROTOCOL_META_KEY];
  return typeof version === "string" && version !== "" ? version : undefined;
}
