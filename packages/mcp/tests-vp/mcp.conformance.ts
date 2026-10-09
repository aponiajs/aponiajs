import {
  JSONRPC_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  McpServer,
  McpToolRegistry,
  defineMcpTool,
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
  Expect<Equals<typeof JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, -32601>>,
];

const assertions: McpContractAssertions = [true, true];

test("exports official protocol constants", () => {
  expect(assertions).toHaveLength(2);
  expect(MCP_PROTOCOL_VERSION).toBe("2024-11-05");
  expect(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
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
});
