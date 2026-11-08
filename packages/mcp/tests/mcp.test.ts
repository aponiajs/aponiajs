import { describe, expect, test } from "bun:test";
import {
  JSONRPC_ERROR_CODES,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_DISCOVER_METHOD,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_PROTOCOL_META_KEY,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION_HEADER,
  McpServer,
  McpPromptRegistry,
  McpResourceRegistry,
  McpToolRegistry,
  createStatelessHttpHandler,
  defineMcpPrompt,
  defineMcpResource,
  defineMcpTool,
} from "../src/index.ts";

describe("@aponiajs/mcp server and protocol", () => {
  test("defines immutable MCP tool with frozen schema", () => {
    const tool = defineMcpTool<{ query: string }>({
      name: "search",
      description: "Search items",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      handler: (args) => ({
        content: [{ type: "text", text: `Results for ${args.query}` }],
      }),
    });

    expect(tool.name).toBe("search");
    expect(tool.description).toBe("Search items");
    expect(Object.isFrozen(tool)).toBe(true);
    expect(Object.isFrozen(tool.inputSchema)).toBe(true);
  });

  test("manages tool registration and execution in McpToolRegistry", async () => {
    const registry = new McpToolRegistry();
    const tool = defineMcpTool<{ a: number; b: number }>({
      name: "add",
      description: "Add two numbers",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
      },
      handler: (args) => ({
        content: [{ type: "text", text: String((args.a ?? 0) + (args.b ?? 0)) }],
      }),
    });

    registry.register(tool);
    expect(registry.get("add")).toBeDefined();
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe("add");

    const result = await registry.execute("add", { a: 10, b: 20 });
    expect(result.content[0].text).toBe("30");

    expect(registry.unregister("add")).toBe(true);
    expect(registry.get("add")).toBeUndefined();
    expect(registry.execute("add", {})).rejects.toThrow('Tool "add" is not registered.');
  });

  test("handles JSON-RPC 2.0 lifecycle: initialize, ping, notifications/initialized", async () => {
    const server = new McpServer({ name: "test-mcp", version: "1.2.3" });

    // 1. initialize
    const initRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    expect(initRes).toBeDefined();
    if (initRes && "result" in initRes) {
      expect((initRes.result as any).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect((initRes.result as any).serverInfo.name).toBe("test-mcp");
      expect((initRes.result as any).serverInfo.version).toBe("1.2.3");
    }

    // 2. notifications/initialized returns null
    const notifRes = await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notifRes).toBeNull();

    // 3. ping
    const pingRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });
    expect(pingRes).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  test("handles tools/list and tools/call via JSON-RPC 2.0", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    server.registerTool(
      defineMcpTool<{ echo: string }>({
        name: "echo_tool",
        description: "Echo argument",
        inputSchema: { type: "object", properties: { echo: { type: "string" } } },
        handler: (args) => ({
          content: [{ type: "text", text: args.echo ?? "empty" }],
        }),
      }),
    );

    // tools/list
    const listRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
    });
    expect(listRes).toBeDefined();
    if (listRes && "result" in listRes) {
      expect((listRes.result as any).tools).toHaveLength(1);
      expect((listRes.result as any).tools[0].name).toBe("echo_tool");
    }

    // tools/call success
    const callRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "echo_tool",
        arguments: { echo: "hello world" },
      },
    });
    expect(callRes).toBeDefined();
    if (callRes && "result" in callRes) {
      expect((callRes.result as any).content[0].text).toBe("hello world");
    }

    // tools/call with throwing handler captures isError
    server.registerTool(
      defineMcpTool({
        name: "failing_tool",
        description: "Always fails",
        inputSchema: { type: "object" },
        handler: () => {
          throw new Error("Deliberate tool failure");
        },
      }),
    );

    const failCallRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "failing_tool" },
    });
    expect(failCallRes).toBeDefined();
    if (failCallRes && "result" in failCallRes) {
      expect((failCallRes.result as any).isError).toBe(true);
      expect((failCallRes.result as any).content[0].text).toContain("Deliberate tool failure");
    }
  });

  test("handles JSON-RPC error conditions properly", async () => {
    const server = new McpServer({ name: "err-server", version: "1.0.0" });

    // Invalid request format
    const invalidObj = await server.handleMessage(null);
    expect(invalidObj).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request" },
    });

    // Missing method or invalid jsonrpc
    const missingMethod = await server.handleMessage({ jsonrpc: "1.0", id: 1 });
    expect(missingMethod).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid JSON-RPC 2.0 Request" },
    });

    // Method not found
    const unknownMethod = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "non_existent_method",
    });
    expect(unknownMethod).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: 'Method "non_existent_method" not found',
      },
    });

    // Invalid params for tools/call
    const invalidParams = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: "not an object",
    });
    expect(invalidParams).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: "Invalid params for tools/call" },
    });

    // Missing tool name
    const missingToolName = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {},
    });
    expect(missingToolName).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: "Tool name is required" },
    });

    // Unregistered tool
    const unregisteredTool = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "ghost" },
    });
    expect(unregisteredTool).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: {
        code: JSONRPC_ERROR_CODES.INVALID_PARAMS,
        message: 'Tool "ghost" is not registered',
      },
    });
  });

  test("serves stateless HTTP handler with GET discovery and POST JSON-RPC", async () => {
    const server = new McpServer({ name: "http-test", version: "2.0.0" });
    const handler = createStatelessHttpHandler(server);

    // GET discovery
    const getRes = await handler(new Request("http://localhost/mcp", { method: "GET" }));
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as any;
    expect(getData.status).toBe("ready");
    expect(getData.protocol).toBe("mcp");
    expect(getData.version).toBe(MCP_PROTOCOL_VERSION);

    // Unsupported method (e.g. PUT)
    const putRes = await handler(new Request("http://localhost/mcp", { method: "PUT" }));
    expect(putRes.status).toBe(405);
    expect(putRes.headers.get("allow")).toBe("GET, POST");

    // Invalid JSON POST
    const malformedReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const malformedRes = await handler(malformedReq);
    expect(malformedRes.status).toBe(400);
    const malformedData = (await malformedRes.json()) as any;
    expect(malformedData.error.code).toBe(JSONRPC_ERROR_CODES.PARSE_ERROR);

    // Valid POST ping
    const pingReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }),
    });
    const pingRes = await handler(pingReq);
    expect(pingRes.status).toBe(200);
    const pingData = (await pingRes.json()) as any;
    expect(pingData.result).toEqual({});

    // Notification POST returns 204
    const notifReq = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const notifRes = await handler(notifReq);
    expect(notifRes.status).toBe(204);
  });

  test("negotiates the handshake version a supported client asks for", async () => {
    const server = new McpServer({ name: "negotiated", version: "1.0.0" });

    for (const version of MCP_PROTOCOL_VERSIONS) {
      const response = await server.handleMessage({
        jsonrpc: "2.0",
        id: version,
        method: "initialize",
        params: {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: "client", version: "1.0.0" },
        },
      });
      expect(resultOf(response).protocolVersion).toBe(version);
    }

    const unsupported = await server.handleMessage({
      jsonrpc: "2.0",
      id: "unsupported",
      method: "initialize",
      params: {
        protocolVersion: "1999-01-01",
        capabilities: {},
        clientInfo: { name: "client", version: "1.0.0" },
      },
    });
    expect(resultOf(unsupported).protocolVersion).toBe(MCP_PROTOCOL_VERSION);

    const unstated = await server.handleMessage({
      jsonrpc: "2.0",
      id: "unstated",
      method: "initialize",
    });
    expect(resultOf(unstated).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(server.protocolVersions).toEqual([...MCP_PROTOCOL_VERSIONS]);
  });

  test("accepts a custom version list and refuses an empty one", async () => {
    const server = new McpServer({
      name: "custom",
      version: "1.0.0",
      protocolVersions: ["2025-06-18"],
    });
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "client", version: "1.0.0" },
      },
    });

    expect(resultOf(response).protocolVersion).toBe("2025-06-18");
    expect(() => new McpServer({ name: "empty", version: "1.0.0", protocolVersions: [] })).toThrow(
      "non-empty list",
    );
    expect(
      () => new McpServer({ name: "blank", version: "1.0.0", protocolVersions: [" "] }),
    ).toThrow("non-empty list");
  });

  test("answers server/discover for a stateless client", async () => {
    const server = new McpServer({ name: "discover", version: "2.0.0" });
    const meta = {
      [MCP_PROTOCOL_META_KEY]: MCP_LATEST_PROTOCOL_VERSION,
      [MCP_CLIENT_CAPABILITIES_META_KEY]: { tools: {} },
    };

    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: MCP_DISCOVER_METHOD,
      params: { _meta: meta },
    });
    const result = resultOf(response);

    expect(result.protocolVersions).toEqual([...MCP_PROTOCOL_VERSIONS]);
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo).toEqual({ name: "discover", version: "2.0.0" });

    const withoutMeta = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: MCP_DISCOVER_METHOD,
      params: {},
    });
    expect(errorOf(withoutMeta).message).toBe("server/discover requires the request meta");

    const withoutCapabilities = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: MCP_DISCOVER_METHOD,
      params: { _meta: { [MCP_PROTOCOL_META_KEY]: MCP_LATEST_PROTOCOL_VERSION } },
    });
    expect(errorOf(withoutCapabilities).message).toBe(
      "server/discover requires client capabilities",
    );

    const unsupported = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: MCP_DISCOVER_METHOD,
      params: {
        _meta: {
          [MCP_PROTOCOL_META_KEY]: "1999-01-01",
          [MCP_CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    });
    expect(errorOf(unsupported).message).toBe("Unsupported protocol version 1999-01-01");

    const invalid = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: MCP_DISCOVER_METHOD,
      params: "no",
    });
    expect(errorOf(invalid).message).toBe("Invalid params for server/discover");
  });

  test("publishes output schemas and passes structured content through", async () => {
    const server = new McpServer({ name: "structured", version: "1.0.0" });
    const tool = defineMcpTool<{ id: string }>({
      name: "lookup",
      description: "Look up one record",
      inputSchema: { type: "object", properties: { id: { type: "string" } } },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
      },
      handler: (args) => ({
        content: [{ type: "text", text: JSON.stringify({ id: args.id, name: "ada" }) }],
        structuredContent: { id: args.id, name: "ada" },
      }),
    });

    expect(tool.outputSchema?.required).toEqual(["id", "name"]);
    expect(Object.isFrozen(tool.outputSchema)).toBe(true);
    server.registerTool(tool);

    const list = resultOf(
      await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(list.tools[0].outputSchema).toEqual(tool.outputSchema);

    const call = resultOf(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "lookup", arguments: { id: "7" } },
      }),
    );
    expect(call.structuredContent).toEqual({ id: "7", name: "ada" });

    const plain = resultOf(
      await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    );
    const echo = defineMcpTool({
      name: "plain",
      description: "No output schema",
      inputSchema: { type: "object" },
      handler: () => ({ content: [] }),
    });
    server.registerTool(echo);
    const listed = resultOf(
      await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    );
    expect(plain.tools).toHaveLength(1);
    expect(listed.tools[1]).not.toHaveProperty("outputSchema");
  });

  test("publishes resources and prompts and answers them", async () => {
    const server = new McpServer({ name: "catalog", version: "1.0.0" });
    server.registerResource(
      defineMcpResource({
        uri: "aponia://greeting",
        name: "Greeting",
        description: "A greeting",
        mimeType: "text/plain",
        read: () => [{ uri: "aponia://greeting", text: "hello", mimeType: "text/plain" }],
      }),
    );
    server.registerPrompt(
      defineMcpPrompt({
        name: "review",
        description: "Review code",
        arguments: [{ name: "code", required: true }],
        get: (arguments_) => ({
          description: "Review",
          messages: [
            { role: "user", content: { type: "text", text: `Review ${arguments_.code}` } },
          ],
        }),
      }),
    );

    const initialized = resultOf(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "client", version: "1.0.0" },
        },
      }),
    );
    expect(initialized.capabilities).toEqual({ tools: {}, resources: {}, prompts: {} });

    const resources = resultOf(
      await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "resources/list" }),
    );
    expect(resources.resources).toEqual([
      {
        uri: "aponia://greeting",
        name: "Greeting",
        description: "A greeting",
        mimeType: "text/plain",
      },
    ]);
    const read = resultOf(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "aponia://greeting" },
      }),
    );
    expect(read.contents).toEqual([
      { uri: "aponia://greeting", text: "hello", mimeType: "text/plain" },
    ]);

    const prompts = resultOf(
      await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "prompts/list" }),
    );
    expect(prompts.prompts).toEqual([
      { name: "review", description: "Review code", arguments: [{ name: "code", required: true }] },
    ]);
    const built = resultOf(
      await server.handleMessage({
        jsonrpc: "2.0",
        id: 5,
        method: "prompts/get",
        params: { name: "review", arguments: { code: "const x = 1;" } },
      }),
    );
    expect(built.messages[0].content.text).toBe("Review const x = 1;");

    expect(
      errorOf(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 6,
          method: "resources/read",
          params: { uri: "missing" },
        }),
      ).message,
    ).toBe('Resource "missing" is not registered');
    expect(
      errorOf(
        await server.handleMessage({ jsonrpc: "2.0", id: 7, method: "resources/read", params: {} }),
      ).message,
    ).toBe("Resource uri is required");
    expect(
      errorOf(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 8,
          method: "prompts/get",
          params: { name: "missing" },
        }),
      ).message,
    ).toBe('Prompt "missing" is not registered');
    expect(
      errorOf(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 9,
          method: "prompts/get",
          params: { name: "review", arguments: { code: 1 } },
        }),
      ).message,
    ).toBe('Prompt argument "code" must be a string');
  });

  test("refuses malformed resource and prompt requests", async () => {
    const server = new McpServer({ name: "malformed", version: "1.0.0" });
    const resources = new McpResourceRegistry();
    const prompts = new McpPromptRegistry();
    resources.register(defineMcpResource({ uri: "a://b", name: "B", read: () => [] }));
    prompts.register(defineMcpPrompt({ name: "p", get: () => ({ messages: [] }) }));

    expect(resources.get("a://b")?.name).toBe("B");
    expect(resources.size).toBe(1);
    expect(resources.unregister("a://b")).toBe(true);
    expect(resources.get("a://b")).toBeUndefined();
    expect(prompts.get("p")?.name).toBe("p");
    expect(prompts.size).toBe(1);
    expect(prompts.unregister("p")).toBe(true);

    const cases: readonly [Record<string, unknown>, string][] = [
      [
        { jsonrpc: "2.0", id: 1, method: "resources/read", params: null },
        "Invalid params for resources/read",
      ],
      [
        { jsonrpc: "2.0", id: 2, method: "prompts/get", params: null },
        "Invalid params for prompts/get",
      ],
      [{ jsonrpc: "2.0", id: 3, method: "prompts/get", params: {} }, "Prompt name is required"],
    ];
    for (const [message, expected] of cases) {
      expect(errorOf(await server.handleMessage(message)).message).toBe(expected);
    }

    server.registerPrompt(defineMcpPrompt({ name: "typed", get: () => ({ messages: [] }) }));
    expect(
      errorOf(
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 4,
          method: "prompts/get",
          params: { name: "typed", arguments: "no" },
        }),
      ).message,
    ).toBe("Prompt arguments must be an object");
  });

  test("refuses an empty resource or prompt declaration", () => {
    expect(() => defineMcpResource({ uri: "", name: "x", read: () => [] })).toThrow(
      "non-empty uri",
    );
    expect(() => defineMcpResource({ uri: "a://b", name: " ", read: () => [] })).toThrow(
      "non-empty name",
    );
    expect(() =>
      defineMcpResource({
        uri: "a://b",
        name: "x",
        read: "no" as unknown as () => readonly [],
      }),
    ).toThrow("read function");
    expect(() => defineMcpPrompt({ name: "", get: () => ({ messages: [] }) })).toThrow(
      "non-empty name",
    );
    expect(() =>
      defineMcpPrompt({
        name: "x",
        get: "no" as unknown as () => { readonly messages: readonly [] },
      }),
    ).toThrow("get function");
  });

  test("reports a resource or prompt failure without leaking its cause", async () => {
    const server = new McpServer({ name: "failures", version: "1.0.0" });
    server.registerResource(
      defineMcpResource({
        uri: "aponia://broken",
        name: "Broken",
        read: () => {
          throw new Error("private storage detail");
        },
      }),
    );
    server.registerPrompt(
      defineMcpPrompt({
        name: "broken",
        get: () => {
          throw new Error("private prompt detail");
        },
      }),
    );

    const resourceFailure = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "aponia://broken" },
    });
    const promptFailure = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/get",
      params: { name: "broken" },
    });

    expect(errorOf(resourceFailure).message).toBe("The resource could not be read");
    expect(errorOf(promptFailure).message).toBe("The prompt could not be built");
    expect(JSON.stringify([resourceFailure, promptFailure])).not.toContain("private");
  });

  test("validates the stateless protocol header against the request meta", async () => {
    const server = new McpServer({ name: "header", version: "1.0.0" });
    const handler = createStatelessHttpHandler(server);
    const meta = {
      [MCP_PROTOCOL_META_KEY]: "2025-06-18",
      [MCP_CLIENT_CAPABILITIES_META_KEY]: {},
    };

    const accepted = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [MCP_PROTOCOL_VERSION_HEADER]: "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: MCP_DISCOVER_METHOD,
          params: { _meta: meta },
        }),
      }),
    );
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as any).result.protocolVersions).toEqual([
      ...MCP_PROTOCOL_VERSIONS,
    ]);

    const unsupported = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [MCP_PROTOCOL_VERSION_HEADER]: "1999-01-01",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
      }),
    );
    expect(unsupported.status).toBe(400);
    expect(((await unsupported.json()) as any).error.message).toBe(
      "Unsupported protocol version 1999-01-01",
    );

    const mismatch = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [MCP_PROTOCOL_VERSION_HEADER]: "2025-03-26",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: MCP_DISCOVER_METHOD,
          params: { _meta: meta },
        }),
      }),
    );
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as any).error.message).toContain("2025-06-18");

    const discovery = await handler(new Request("http://localhost/mcp", { method: "GET" }));
    expect(((await discovery.json()) as any).protocolVersions).toEqual([...MCP_PROTOCOL_VERSIONS]);
  });
});

function resultOf(response: Awaited<ReturnType<McpServer["handleMessage"]>>): any {
  if (response === null || !("result" in response)) {
    throw new Error("Expected a JSON-RPC success response.");
  }
  return response.result;
}

function errorOf(response: Awaited<ReturnType<McpServer["handleMessage"]>>): { message: string } {
  if (response === null || !("error" in response)) {
    throw new Error("Expected a JSON-RPC error response.");
  }
  return response.error;
}
