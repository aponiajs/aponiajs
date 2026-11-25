import { type DynamicModule } from "@aponiajs/common";
import { wrapElysiaPlugin } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

const BridgeModule = wrapElysiaPlugin({
  name: "dummy-bridge",
  plugin: () => ({}) as any,
});

type PluginBuilderAssertions = [
  Expect<Equals<ReturnType<typeof BridgeModule.forRoot>, DynamicModule>>,
];

const assertions: PluginBuilderAssertions = [true];

test("conforms to dynamic module returns for plugin builders", () => {
  expect(assertions).toHaveLength(1);
  expect(BridgeModule.forRoot()).toBeDefined();
});
