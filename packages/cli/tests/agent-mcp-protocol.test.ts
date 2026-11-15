import { describe, expect, test } from "bun:test";
import {
  AgentMcpServer,
  agentMcpProtocolVersion,
  agentMcpProtocolVersions,
  defineAgentTool,
} from "../src/agent/mcp-protocol.ts";

function createServer(): AgentMcpServer {
  return new AgentMcpServer({ name: "aponia-test", version: "0.0.0" });
}

function readError(response: unknown): { readonly code: number; readonly message: string } {
  return (response as { readonly error: { readonly code: number; readonly message: string } })
    .error;
}

describe("AgentMcpServer protocol", () => {
  test("refuses a duplicate tool name", () => {
    const server = createServer();
    const tool = defineAgentTool({
      name: "echo",
      description: "Echoes its input.",
      inputSchema: { type: "object" },
      handler: () => "ok",
    });

    server.registerTool(tool);
    expect(() => server.registerTool(tool)).toThrow('MCP tool "echo" is already registered.');
  });

  test("rejects a frame that is not a JSON-RPC request", async () => {
    const server = createServer();

    for (const message of [null, "text", [], { jsonrpc: "2.0" }]) {
      const response = await server.handleMessage(message);
      expect(readError(response)).toMatchObject({ code: -32600, message: "Invalid Request" });
    }

    const withId = await server.handleMessage({ jsonrpc: "1.0", method: "ping", id: 7 });
    expect((withId as { readonly id: unknown }).id).toBe(7);
    expect(readError(withId).code).toBe(-32600);
  });

  test("answers initialize, notifications, ping, and an unknown method", async () => {
    const server = createServer();

    const initialized = await server.handleMessage({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
    });
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: "init",
      result: {
        protocolVersion: agentMcpProtocolVersion,
        serverInfo: { name: "aponia-test", version: "0.0.0" },
      },
    });

    expect(
      await server.handleMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    ).toBeNull();

    expect(await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "ping" })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });

    const unknown = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/purge",
    });
    expect(readError(unknown)).toEqual({ code: -32601, message: 'Method "tools/purge" not found' });
  });

  test("rejects malformed server and discovery parameters", async () => {
    const server = createServer();

    const noParams = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: "bad",
    });
    expect(readError(noParams)).toEqual({
      code: -32602,
      message: "Invalid params for server/discover",
    });

    const badMeta = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "server/discover",
      params: { _meta: "bad" },
    });
    expect(readError(badMeta)).toEqual({
      code: -32602,
      message: "server/discover requires the request meta",
    });

    const accepted = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": agentMcpProtocolVersions[1],
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    expect(accepted).toMatchObject({
      result: { protocolVersions: agentMcpProtocolVersions },
    });
  });

  test("rejects malformed tool calls and reports a failing tool", async () => {
    const server = createServer().registerTool(
      defineAgentTool({
        name: "explode",
        description: "Always fails.",
        inputSchema: { type: "object" },
        handler: () => {
          throw new Error("boom");
        },
      }),
    );

    const noParams = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: null,
    });
    expect(readError(noParams)).toEqual({
      code: -32602,
      message: "Invalid params for tools/call",
    });

    const noName = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {},
    });
    expect(readError(noName)).toEqual({ code: -32602, message: "Tool name is required" });

    const unknown = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "missing" },
    });
    expect(readError(unknown)).toEqual({
      code: -32602,
      message: 'Tool "missing" is not registered',
    });

    for (const [failure, message] of [
      [new Error("boom"), "boom"],
      [42, "42"],
    ] as const) {
      const serverWithFailure = createServer().registerTool(
        defineAgentTool({
          name: "explode",
          description: "Always fails.",
          inputSchema: { type: "object" },
          handler: () => {
            throw failure;
          },
        }),
      );
      const response = await serverWithFailure.handleMessage({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "explode", arguments: null },
      });
      expect(response).toMatchObject({
        result: {
          isError: true,
          content: [{ type: "text", text: `Tool error: ${message}` }],
        },
      });
    }
  });
});
