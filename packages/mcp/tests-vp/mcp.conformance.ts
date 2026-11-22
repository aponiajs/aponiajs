import { McpModule } from "../src/index.ts";
import type {
  McpAuthorize,
  McpConfiguration,
  McpModuleOptions,
  McpServerFactory,
} from "../src/index.ts";
import type { DynamicModule } from "@aponiajs/common";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * Conformance assertions for the MCP endpoint contract.
 */
type McpContractAssertions = [
  Expect<Equals<ReturnType<typeof McpModule.register>, DynamicModule>>,
  Expect<Equals<McpModuleOptions["sessions"], "stateless" | "stateful" | undefined>>,
  Expect<Equals<McpConfiguration["path"], string | undefined>>,
  Expect<Equals<McpConfiguration["allowedOrigins"], readonly string[] | undefined>>,
  Expect<Equals<McpConfiguration["allowUnauthenticated"], boolean | undefined>>,
  Expect<
    Equals<McpServerFactory, () => import("@modelcontextprotocol/sdk/server/mcp.js").McpServer>
  >,
  Expect<Equals<McpAuthorize, (request: Request) => boolean | Promise<boolean>>>,
];

const assertions: McpContractAssertions = [true, true, true, true, true, true, true];

test("exports the MCP endpoint contract", () => {
  expect(assertions).toHaveLength(7);
  expect(typeof McpModule.register).toBe("function");
});
