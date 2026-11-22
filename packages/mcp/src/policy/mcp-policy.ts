import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Elysia } from "elysia";
import type { McpAuthorize, McpServerFactory } from "../module/mcp-module.types.ts";
import type { McpSessionRegistry } from "../session/mcp-session-registry.ts";
import type { McpConfiguration, McpPolicy } from "./mcp-policy.types.ts";

/** What the plugin needs once the container has resolved the configuration. */
export interface McpPluginBuildOptions {
  readonly policy: McpPolicy;
  readonly serverFactory: McpServerFactory;
  readonly authorize: McpAuthorize | undefined;
  readonly registry: McpSessionRegistry;
  readonly stateful: boolean;
  readonly jsonResponse: boolean;
}

/**
 * Reads the endpoint policy from the value a configuration validated into.
 *
 * A guard rather than a cast: a `defineConfiguration` transform is arbitrary
 * JavaScript, and a JavaScript caller can hand the module a schema that answers
 * anything at all. A path that is not absolute, an origin list that is not a
 * list of strings, or a registration with no way to authenticate is refused at
 * boot with the declaration's name and every issue, the way a schema refusal
 * reports them.
 *
 * @internal
 */
export function readMcpPolicy<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<McpConfiguration>,
  authorize: McpAuthorize | undefined,
): McpPolicy {
  const name = configuration.description;
  const candidate = value as RawMcpConfiguration | null | undefined;

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw invalidConfigurationValue(name, [
      'The value must be an object carrying "path", "allowedOrigins", and "allowUnauthenticated"',
    ]);
  }

  const path = candidate.path ?? "/mcp";
  const allowedOrigins = candidate.allowedOrigins ?? [];
  const allowUnauthenticated = candidate.allowUnauthenticated ?? false;
  const issues: string[] = [];

  if (typeof path !== "string" || path.length === 0 || !path.startsWith("/")) {
    issues.push('"path" must be an absolute path such as "/mcp"');
  }

  if (!isNonEmptyStringArray(allowedOrigins)) {
    issues.push('"allowedOrigins" must be an array of non-empty origin strings');
  }

  if (typeof allowUnauthenticated !== "boolean") {
    issues.push('"allowUnauthenticated" must be a boolean when it is present');
  }

  if (authorize === undefined && allowUnauthenticated !== true) {
    issues.push('"authorize" is required unless "allowUnauthenticated" is true');
  }

  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  // The guard above is what makes these fields the declared types; this states
  // what it proved, the way the CORS and OpenAPI guards state theirs.
  return Object.freeze({
    path: path as string,
    allowedOrigins: Object.freeze([...(allowedOrigins as readonly string[])]),
    allowUnauthenticated: allowUnauthenticated as boolean,
  });
}

/**
 * Builds the native plugin that serves the endpoint.
 *
 * One Elysia route owns the configured path and every method, because the MCP
 * transport decides what a method means. The plugin adds only the request gate
 * this framework owns: an Origin allowlist, the application's `authorize`
 * decision, and the preflight answer a browser client needs.
 *
 * @internal
 */
export function buildMcpPlugin(options: McpPluginBuildOptions): ElysiaPlugin {
  const plugin = new Elysia({ name: "aponia.mcp" }).all(options.policy.path, ({ request }) =>
    handleRequest(request, options),
  );

  return plugin;
}

type GateDecision =
  | { readonly kind: "answer"; readonly response: Response }
  | { readonly kind: "continue"; readonly origin: string | null };

/**
 * Decides the request before the transport sees it.
 *
 * Origin first: a browser request the policy did not allow is refused before an
 * `authorize` callback can be asked about it. `OPTIONS` is answered here
 * because a preflight carries no tool call and the transport has no answer for
 * it. Authentication runs only when the options asked for it.
 */
async function readGateDecision(
  request: Request,
  options: McpPluginBuildOptions,
): Promise<GateDecision> {
  const origin = request.headers.get("origin");

  if (origin !== null && !options.policy.allowedOrigins.includes(origin)) {
    return { kind: "answer", response: new Response(null, { status: 403 }) };
  }

  if (request.method === "OPTIONS") {
    return { kind: "answer", response: preflightResponse(request, origin) };
  }

  if (options.authorize !== undefined) {
    let allowed = false;

    try {
      allowed = (await options.authorize(request)) === true;
    } catch {
      allowed = false;
    }

    if (!allowed) {
      return { kind: "answer", response: unauthorizedResponse() };
    }
  } else if (!options.policy.allowUnauthenticated) {
    return { kind: "answer", response: unauthorizedResponse() };
  }

  return { kind: "continue", origin };
}

async function handleRequest(request: Request, options: McpPluginBuildOptions): Promise<Response> {
  const decision = await readGateDecision(request, options);

  if (decision.kind === "answer") {
    return decision.response;
  }

  const response = options.stateful
    ? await handleStatefulRequest(request, options)
    : await handleStatelessRequest(request, options);

  return withCors(response, decision.origin);
}

/**
 * One server and one transport per request.
 *
 * A transport belongs to the server it is connected to, and an SDK server
 * connects to one transport, so a stateless endpoint builds both for each
 * request and closes them when the response body is finished. That is also the
 * shape a serverless host needs: no state survives the request.
 */
async function handleStatelessRequest(
  request: Request,
  options: McpPluginBuildOptions,
): Promise<Response> {
  const server = options.serverFactory();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: options.jsonResponse,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);

    return withCleanup(response, async () => {
      await server.close();
    });
  } catch (error) {
    await server.close();
    throw error;
  }
}

/**
 * One server and one transport per session, keyed by `mcp-session-id`.
 *
 * A request without a session id is the one that starts a session: the
 * transport answers the initialize request, publishes the id, and the registry
 * keeps the pair for the requests that carry it. A request naming a session the
 * registry does not hold is refused rather than answered by a fresh one.
 */
async function handleStatefulRequest(
  request: Request,
  options: McpPluginBuildOptions,
): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId !== null) {
    const session = options.registry.get(sessionId);

    if (session === undefined) {
      return new Response(null, { status: 404 });
    }

    return session.transport.handleRequest(request);
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 400 });
  }

  const server = options.serverFactory();
  let initialized = false;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: options.jsonResponse,
    onsessioninitialized: (id) => {
      initialized = true;
      options.registry.set(id, { server, transport });
    },
    onsessionclosed: async (id) => {
      const session = options.registry.get(id);
      options.registry.delete(id);
      await session?.server.close();
    },
  });

  let response: Response;

  try {
    await server.connect(transport);
    response = await transport.handleRequest(request);
  } catch (error) {
    await server.close();
    throw error;
  }

  if (!initialized) {
    await server.close();
  }

  return response;
}

/** Answers a preflight for an origin the policy already allowed. */
function preflightResponse(request: Request, origin: string | null): Response {
  const headers = new Headers({
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers":
      request.headers.get("access-control-request-headers") ??
      "authorization, content-type, last-event-id, mcp-protocol-version, mcp-session-id",
    "access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
    "access-control-max-age": "600",
    vary: "Origin",
  });

  if (origin !== null) {
    headers.set("access-control-allow-origin", origin);
  }

  return new Response(null, { status: 204, headers });
}

/** Adds the cross-origin headers a browser client needs on the real answer. */
function withCors(response: Response, origin: string | null): Response {
  if (origin === null) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", "mcp-protocol-version, mcp-session-id");
  headers.append("vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Runs the cleanup when the body the caller reads is finished.
 *
 * An SDK response may be an SSE stream that outlives the call to
 * `handleRequest`, so the transport and server cannot be closed when that call
 * returns. A bodyless answer has nothing to wait for and is cleaned immediately.
 */
function withCleanup(response: Response, cleanup: () => Promise<void>): Response {
  if (response.body === null) {
    void cleanup();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  const finish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    void cleanup();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();

        if (chunk.done) {
          controller.close();
          finish();
          return;
        }

        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    cancel() {
      finish();
      return reader.cancel();
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

interface RawMcpConfiguration {
  readonly path?: unknown;
  readonly allowedOrigins?: unknown;
  readonly allowUnauthenticated?: unknown;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function unauthorizedResponse(): Response {
  return new Response(null, {
    status: 401,
    headers: { "www-authenticate": "Bearer" },
  });
}

function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid MCP configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
