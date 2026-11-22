import { describe, expect, test } from "bun:test";
import { AponiaError, Module, defineConfiguration } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Elysia } from "elysia";
import { z } from "zod";
import { McpModule } from "../src/index.ts";
import { buildMcpPlugin, readMcpPolicy } from "../src/policy/mcp-policy.ts";
import { McpSessionRegistry } from "../src/session/mcp-session-registry.ts";

const endpoint = "http://localhost:3000";

const mcpConfiguration = defineConfiguration(
  z.object({
    path: z.string(),
    allowedOrigins: z.array(z.string()),
    allowUnauthenticated: z.boolean(),
  }),
  "mcp.test",
);

function buildServer(): McpServer {
  const server = new McpServer({ name: "test-mcp", version: "1.0.0" });

  server.registerTool(
    "add",
    { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );

  return server;
}

interface ApplicationOptions {
  readonly path?: string;
  readonly allowedOrigins?: readonly string[];
  readonly allowUnauthenticated?: boolean;
  readonly authorize?: ((request: Request) => boolean | Promise<boolean>) | null;
  readonly sessions?: "stateless" | "stateful";
  readonly jsonResponse?: boolean;
}

async function createApplication(options: ApplicationOptions = {}): Promise<AponiaApplication> {
  const defaultAuthorize = (request: Request): boolean =>
    request.headers.get("authorization") === "Bearer test";
  const authorize =
    options.authorize === null ? undefined : (options.authorize ?? defaultAuthorize);

  const mcp = McpModule.register({
    configuration: mcpConfiguration,
    source: {
      path: options.path ?? "/mcp",
      allowedOrigins: options.allowedOrigins ?? [],
      allowUnauthenticated: options.allowUnauthenticated ?? false,
    },
    useFactory: () => () => buildServer(),
    authorize,
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    jsonResponse: options.jsonResponse ?? true,
  });

  @Module({ imports: [mcp] })
  class McpTestModule {}

  return AponiaFactory.create(McpTestModule, { logger: false });
}

function initializeBody(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

function postTo(path: string, body: unknown, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json, text/event-stream");
  headers.set("authorization", "Bearer test");
  const { headers: _ignored, ...rest } = init;

  return new Request(`${endpoint}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    ...rest,
    headers,
  });
}

async function captureFailure(run: () => Promise<unknown>): Promise<AponiaError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    return error as AponiaError;
  }

  throw new Error("expected the boot to fail");
}

describe("@aponiajs/mcp endpoint", () => {
  test("serves initialize, tools/list, and tools/call through the application", async () => {
    const application = await createApplication();

    const initialized = await application.handle(postTo("/mcp", initializeBody()));
    expect(initialized.status).toBe(200);
    const initializedPayload = (await initialized.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(initializedPayload.result.protocolVersion).toBe("2025-06-18");
    expect(initializedPayload.result.serverInfo.name).toBe("test-mcp");

    const listed = await application.handle(
      postTo("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const listedPayload = (await listed.json()) as {
      result: { tools: readonly { name: string }[] };
    };
    expect(listedPayload.result.tools.map((tool) => tool.name)).toContain("add");

    const called = await application.handle(
      postTo("/mcp", {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "add", arguments: { a: 2, b: 3 } },
      }),
    );
    const calledPayload = (await called.json()) as {
      result: { content: readonly { text: string }[] };
    };
    expect(calledPayload.result.content[0]?.text).toBe("5");

    await application.close();
  });

  test("answers a notification with an empty 202 and closes the request server", async () => {
    const application = await createApplication();

    const response = await application.handle(
      postTo("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }),
    );

    expect(response.status).toBe(202);
    expect(response.body).toBeNull();
    await application.close();
  });

  test("streams an SSE answer when JSON responses are not requested", async () => {
    const application = await createApplication({ jsonResponse: false });

    const response = await application.handle(postTo("/mcp", initializeBody()));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain('"serverInfo"');
    await application.close();
  });

  test("refuses a request the authorize callback rejects", async () => {
    const application = await createApplication({ authorize: () => false });

    const response = await application.handle(postTo("/mcp", initializeBody()));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    await application.close();
  });

  test("refuses a request when authorize throws", async () => {
    const application = await createApplication({
      authorize: () => {
        throw new Error("policy unavailable");
      },
    });

    const response = await application.handle(postTo("/mcp", initializeBody()));

    expect(response.status).toBe(401);
    await application.close();
  });

  test("serves without authorize when the configuration allows it", async () => {
    const application = await createApplication({
      authorize: null,
      allowUnauthenticated: true,
    });

    const response = await application.handle(postTo("/mcp", initializeBody()));

    expect(response.status).toBe(200);
    await application.close();
  });

  test("refuses an origin the policy does not allow and answers the allowed one", async () => {
    const application = await createApplication({ allowedOrigins: ["https://app.example"] });

    const refused = await application.handle(
      postTo("/mcp", initializeBody(), { headers: { origin: "https://evil.example" } }),
    );
    expect(refused.status).toBe(403);

    const allowed = await application.handle(
      postTo("/mcp", initializeBody(), { headers: { origin: "https://app.example" } }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(allowed.headers.get("vary")).toContain("Origin");

    await application.close();
  });

  test("answers a preflight without running the transport", async () => {
    const application = await createApplication({ allowedOrigins: ["https://app.example"] });

    const response = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example",
          "access-control-request-method": "POST",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    await application.close();
  });

  test("refuses a body that is not JSON", async () => {
    const application = await createApplication();

    const response = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test",
          "content-type": "text/plain",
        },
        body: "hello",
      }),
    );

    expect(response.status).toBe(415);
    await application.close();
  });

  test("answers 405 for a method the transport does not serve", async () => {
    const application = await createApplication();

    const response = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "PUT",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST, DELETE");
    await application.close();
  });

  test("mounts on the configured path", async () => {
    const application = await createApplication({ path: "/rpc" });

    const served = await application.handle(postTo("/rpc", initializeBody()));
    expect(served.status).toBe(200);

    const missing = await application.handle(postTo("/mcp", initializeBody()));
    expect(missing.status).toBe(404);
    await application.close();
  });

  test("keeps a stateful session until the client deletes it", async () => {
    const application = await createApplication({ sessions: "stateful" });

    const initialized = await application.handle(postTo("/mcp", initializeBody()));
    const sessionId = initialized.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const listed = await application.handle(
      postTo(
        "/mcp",
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { headers: { "mcp-session-id": sessionId ?? "" } },
      ),
    );
    expect(listed.status).toBe(200);

    const closed = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "DELETE",
        headers: { authorization: "Bearer test", "mcp-session-id": sessionId ?? "" },
      }),
    );
    expect([200, 204]).toContain(closed.status);

    const forgotten = await application.handle(
      postTo(
        "/mcp",
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { headers: { "mcp-session-id": sessionId ?? "" } },
      ),
    );
    expect(forgotten.status).toBe(404);

    const unopened = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "GET",
        headers: { authorization: "Bearer test" },
      }),
    );
    expect(unopened.status).toBe(400);

    await application.close();
  });

  test("closes a stateful server when the opening request never initializes", async () => {
    const application = await createApplication({ sessions: "stateful" });

    const response = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await application.close();
  });

  test("cleans up an SSE answer the client cancels", async () => {
    const application = await createApplication({ jsonResponse: false });

    const response = await application.handle(postTo("/mcp", initializeBody()));
    await response.body?.cancel();

    await application.close();
  });

  test("answers 401 when the plugin is built without a gate", async () => {
    const plugin = buildMcpPlugin({
      policy: { path: "/mcp", allowedOrigins: [], allowUnauthenticated: false },
      serverFactory: () => buildServer(),
      authorize: undefined,
      registry: new McpSessionRegistry(),
      stateful: false,
      jsonResponse: true,
    });
    const application = new Elysia().use(plugin);

    const response = await application.handle(
      new Request(`${endpoint}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(initializeBody()),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("closes a stateless server when the transport refuses to connect", async () => {
    let closed = 0;
    const plugin = buildMcpPlugin({
      policy: { path: "/mcp", allowedOrigins: [], allowUnauthenticated: true },
      serverFactory: () =>
        ({
          connect: async () => {
            throw new Error("transport refused");
          },
          close: async () => {
            closed += 1;
          },
        }) as unknown as McpServer,
      authorize: undefined,
      registry: new McpSessionRegistry(),
      stateful: false,
      jsonResponse: true,
    });
    const application = new Elysia().use(plugin);

    const response = await application.handle(
      postTo("/mcp", initializeBody(), { headers: { authorization: "" } }),
    );

    expect(response.status).toBe(500);
    expect(closed).toBe(1);
  });

  test("closes a stateful server when the transport refuses to connect", async () => {
    let closed = 0;
    const plugin = buildMcpPlugin({
      policy: { path: "/mcp", allowedOrigins: [], allowUnauthenticated: true },
      serverFactory: () =>
        ({
          connect: async () => {
            throw new Error("transport refused");
          },
          close: async () => {
            closed += 1;
          },
        }) as unknown as McpServer,
      authorize: undefined,
      registry: new McpSessionRegistry(),
      stateful: true,
      jsonResponse: true,
    });
    const application = new Elysia().use(plugin);

    const response = await application.handle(postTo("/mcp", initializeBody()));

    expect(response.status).toBe(500);
    expect(closed).toBe(1);
  });
});

describe("@aponiajs/mcp policy", () => {
  test("fills the defaults and freezes the origin list", () => {
    const policy = readMcpPolicy({}, mcpConfiguration, () => true);

    expect(policy.path).toBe("/mcp");
    expect(policy.allowedOrigins).toEqual([]);
    expect(policy.allowUnauthenticated).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  test("refuses a value that is not an object", () => {
    expect(() => readMcpPolicy(null, mcpConfiguration, () => true)).toThrow(AponiaError);
  });

  test("refuses a non-boolean unauthenticated switch", () => {
    expect(() =>
      readMcpPolicy({ allowUnauthenticated: "yes" }, mcpConfiguration, () => true),
    ).toThrow(AponiaError);
  });

  test("refuses a factory that returns no server factory", async () => {
    const mcp = McpModule.register({
      configuration: mcpConfiguration,
      source: { path: "/mcp", allowedOrigins: [], allowUnauthenticated: true },
      useFactory: (() => undefined) as never,
    });

    @Module({ imports: [mcp] })
    class BrokenRootModule {}

    const failure = await captureFailure(() =>
      AponiaFactory.create(BrokenRootModule, { logger: false }),
    );

    expect(failure.code).toBe("INVALID_CONFIGURATION_VALUE");
  });

  test("refuses a configuration without a way to authenticate", async () => {
    const failure = await captureFailure(() => createApplication({ authorize: null }));

    expect(failure.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(failure.details.configuration).toBe("mcp.test");
    expect(failure.details.issues).toContainEqual(
      '"authorize" is required unless "allowUnauthenticated" is true',
    );
  });

  test("refuses a path that is not absolute", async () => {
    const failure = await captureFailure(() => createApplication({ path: "mcp" }));

    expect(failure.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(failure.details.issues).toContainEqual('"path" must be an absolute path such as "/mcp"');
  });

  test("refuses an origin list that is not strings", async () => {
    const failure = await captureFailure(() => createApplication({ allowedOrigins: [""] }));

    expect(failure.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(failure.details.issues).toContainEqual(
      '"allowedOrigins" must be an array of non-empty origin strings',
    );
  });
});

describe("@aponiajs/mcp sessions", () => {
  test("stores, reads, and clears the sessions one boot owns", async () => {
    const registry = new McpSessionRegistry();
    let closed = 0;
    const session = {
      server: {
        close: async () => {
          closed += 1;
        },
      },
      transport: {},
    } as never;

    registry.set("session-1", session);
    expect(registry.size).toBe(1);
    expect(registry.get("session-1")).toBe(session);
    expect(registry.get("missing")).toBeUndefined();

    await registry.onApplicationShutdown();

    expect(closed).toBe(1);
    expect(registry.size).toBe(0);
    expect(registry.get("session-1")).toBeUndefined();
  });
});
