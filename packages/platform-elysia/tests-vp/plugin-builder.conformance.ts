import { type DynamicModule } from "@aponiajs/common";
import { createEnhancerPlugin, createServicePlugin, wrapElysiaPlugin } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

class DummyService {
  ping(): string {
    return "pong";
  }
}

const ServiceModule = createServicePlugin({
  name: "dummy-service",
  service: DummyService,
  factory: () => new DummyService(),
});

const EnhancerModule = createEnhancerPlugin({
  name: "dummy-enhancer",
});

const BridgeModule = wrapElysiaPlugin({
  name: "dummy-bridge",
  plugin: () => ({}) as any,
});

type PluginBuilderAssertions = [
  Expect<Equals<ReturnType<typeof ServiceModule.forRoot>, DynamicModule>>,
  Expect<Equals<ReturnType<typeof EnhancerModule.forRoot>, DynamicModule>>,
  Expect<Equals<ReturnType<typeof BridgeModule.forRoot>, DynamicModule>>,
];

const assertions: PluginBuilderAssertions = [true, true, true];

test("conforms to dynamic module returns for plugin builders", () => {
  expect(assertions).toHaveLength(3);
  expect(ServiceModule.forRoot({})).toBeDefined();
  expect(EnhancerModule.forRoot()).toBeDefined();
  expect(BridgeModule.forRoot()).toBeDefined();
});
