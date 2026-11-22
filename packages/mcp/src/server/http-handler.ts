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
export interface StatelessHttpHandlerOptions {
  /** Authorizes one request; a false or throwing answer is a 401. */
  readonly authorize?: (request: Request) => boolean | Promise<boolean>;
  /**
   * Browser origins allowed to call the endpoint.
   *
   * When stated, any request carrying a different Origin is refused. When
   * omitted, a request carrying an Origin is refused, which keeps a browser
   * from calling the endpoint without an explicit allowlist.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Whether a POST must declare `application/json`.
   *
   * Defaults to true. The JSON content type requires a CORS preflight for a
   * cross-origin browser request, which is the transport's CSRF boundary.
   */
  readonly requireJson?: boolean;
}

/**
 * Creates the stateless HTTP transport for one MCP server.
 *
 * The POST branch requires JSON, refuses an unlisted Origin, and runs the
 * optional `authorize` decision before it parses or dispatches a message.
 */
export function createStatelessHttpHandler(
  server: McpServer,
  options: StatelessHttpHandlerOptions = {},
) {
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

    const origin = request.headers.get("origin");
    if (origin !== null) {
      if (options.allowedOrigins === undefined || !options.allowedOrigins.includes(origin)) {
        return new Response(null, { status: 403 });
      }
    }
    if (options.authorize !== undefined) {
      let allowed = false;
      try {
        allowed = await options.authorize(request);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        return new Response(null, { status: 401 });
      }
    }
    if (
      (options.requireJson ?? true) &&
      parsedBody === undefined &&
      !isJsonContentType(request.headers.get("content-type"))
    ) {
      return new Response(null, { status: 415 });
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

function isJsonContentType(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  return value.split(";")[0]?.trim().toLowerCase() === "application/json";
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
