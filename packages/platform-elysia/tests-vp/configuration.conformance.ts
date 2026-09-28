import {
  defineConfiguration,
  type ConfigurationOptions,
  type ConfigurationToken,
} from "@aponiajs/common";
import { z } from "zod";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

const AppConfig = defineConfiguration(z.object({ port: z.coerce.number().default(3000) }));

/**
 * The published token shape, pinned. The declaration carries the schema's
 * output type, and the token stays an injection token, so a signature that
 * widened to the schema's input or stopped extending `InjectionToken` fails
 * `bun run check` here.
 */
type ConfigurationTokenAssertions = [
  Expect<Equals<typeof AppConfig, ConfigurationToken<{ port: number }>>>,
  Expect<Equals<(typeof AppConfig)["id"], symbol>>,
  Expect<Equals<(typeof AppConfig)["description"], string>>,
  Expect<Equals<keyof ConfigurationOptions, "source">>,
  Expect<Equals<ConfigurationOptions["source"], Readonly<Record<string, unknown>> | undefined>>,
];

test("the Vite+ lane keeps a configuration declaration addressable", () => {
  const assertions = Array.from({ length: 5 }, () => true) as ConfigurationTokenAssertions;

  expect(assertions).toHaveLength(5);
  expect(Object.isFrozen(AppConfig)).toBe(true);
  expect(typeof AppConfig.id).toBe("symbol");
  expect(AppConfig.description).toBe("configuration");
  expect(AppConfig.schema).toBeDefined();
});
