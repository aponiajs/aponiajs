import { describe, expect, test } from "bun:test";
import {
  JSONRPC_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  McpServer,
  McpToolRegistry,
  createStatelessHttpHandler,
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
});
