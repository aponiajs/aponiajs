import {
  JSONRPC_ERROR_CODES,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_DISCOVER_METHOD,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_PROTOCOL_META_KEY,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  McpServer,
  McpPromptRegistry,
  McpResourceRegistry,
  McpToolRegistry,
  defineMcpPrompt,
  defineMcpResource,
  defineMcpTool,
  type McpDiscoverResult,
  type McpToolDefinition,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * Conformance assertions for Model Context Protocol contracts.
 */
type McpContractAssertions = [
  Expect<Equals<typeof MCP_PROTOCOL_VERSION, "2024-11-05">>,
  Expect<Equals<typeof MCP_LATEST_PROTOCOL_VERSION, "2025-11-25">>,
  Expect<Equals<typeof JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, -32601>>,
  Expect<
    Equals<
      (typeof MCP_PROTOCOL_VERSIONS)[number],
      "2024-11-05" | "2025-03-26" | "2025-06-18" | "2025-11-25"
    >
  >,
  Expect<Equals<NonNullable<McpToolDefinition["outputSchema"]>, McpToolDefinition["inputSchema"]>>,
];

const assertions: McpContractAssertions = [true, true, true, true, true];

test("exports official protocol constants", () => {
  expect(assertions).toHaveLength(5);
  expect(MCP_PROTOCOL_VERSION).toBe("2024-11-05");
  expect(MCP_PROTOCOL_VERSIONS).toContain(MCP_LATEST_PROTOCOL_VERSION);
  expect(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
});

test("negotiates the version and answers server/discover", async () => {
  const server = new McpServer({ name: "vite-conformance", version: "1.0.0" });
  const initialized = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "client", version: "1.0.0" },
    },
  });
  expect((initialized as { result?: { protocolVersion?: string } }).result?.protocolVersion).toBe(
    MCP_LATEST_PROTOCOL_VERSION,
  );

  const discovered = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: MCP_DISCOVER_METHOD,
    params: {
      _meta: {
        [MCP_PROTOCOL_META_KEY]: MCP_LATEST_PROTOCOL_VERSION,
        [MCP_CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  });
  const result = (discovered as { result?: McpDiscoverResult }).result;
  expect(result?.protocolVersions).toEqual([...MCP_PROTOCOL_VERSIONS]);
  expect(result?.serverInfo.name).toBe("vite-conformance");
});

test("defines immutable tool contracts", () => {
  const tool = defineMcpTool({
    name: "info",
    description: "App info",
    inputSchema: { type: "object" },
    handler: () => ({ content: [{ type: "text", text: "info" }] }),
  });

  expect(tool.name).toBe("info");
  expect(Object.isFrozen(tool)).toBe(true);
});

test("instantiates server and tool registry", () => {
  const server = new McpServer({ name: "conformance-server", version: "1.0.0" });
  expect(server.tools).toBeInstanceOf(McpToolRegistry);
  expect(server.resources).toBeInstanceOf(McpResourceRegistry);
  expect(server.prompts).toBeInstanceOf(McpPromptRegistry);
});

test("publishes resources and prompts through the server", async () => {
  const server = new McpServer({ name: "conformance-catalog", version: "1.0.0" });
  server.registerResource(
    defineMcpResource({
      uri: "conformance://note",
      name: "Note",
      read: () => [{ uri: "conformance://note", text: "hello" }],
    }),
  );
  server.registerPrompt(
    defineMcpPrompt({
      name: "note",
      get: () => ({ messages: [{ role: "user", content: { type: "text", text: "note" } }] }),
    }),
  );

  const read = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/read",
    params: { uri: "conformance://note" },
  });
  const built = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "prompts/get",
    params: { name: "note" },
  });

  expect(
    (read as { result?: { contents?: readonly { text?: string }[] } }).result?.contents?.[0]?.text,
  ).toBe("hello");
  expect(
    (built as { result?: { messages?: readonly { content?: { text?: string } }[] } }).result
      ?.messages?.[0]?.content?.text,
  ).toBe("note");
});
