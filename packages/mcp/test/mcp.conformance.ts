import { McpModule } from "../src/index.ts";
import type {
  McpContext,
  McpExecutionContext,
  McpModuleAsyncOptions,
  McpModuleOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

type McpContractAssertions = [
  Expect<Equals<ReturnType<typeof McpModule.forRoot>, import("@aponiajs/common").DynamicModule>>,
  Expect<Equals<McpModuleOptions["path"], string | false | undefined>>,
  Expect<Equals<McpModuleAsyncOptions["path"], string | false | undefined>>,
  Expect<Equals<McpExecutionContext["getType"], () => "mcp">>,
  Expect<Equals<McpContext["transport"], "http" | "stdio">>,
];

const assertions: McpContractAssertions = [true, true, true, true, true];

test("exports the Nest-style MCP contract", () => {
  expect(assertions).toHaveLength(5);
  expect(typeof McpModule.forRoot).toBe("function");
  expect(typeof McpModule.forRootAsync).toBe("function");
});
