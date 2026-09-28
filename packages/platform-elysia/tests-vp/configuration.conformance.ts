import {
  Inject,
  Injectable,
  Module,
  defineConfiguration,
  type ConfigurationOptions,
  type ConfigurationToken,
  type Provider,
} from "@aponiajs/common";
import { z } from "zod";
import { AponiaFactory, provideConfiguration } from "../src/index.ts";

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
type TokenTypeAssertion = Expect<Equals<typeof AppConfig, ConfigurationToken<{ port: number }>>>;
type TokenIdAssertion = Expect<Equals<(typeof AppConfig)["id"], symbol>>;
type TokenDescriptionAssertion = Expect<Equals<(typeof AppConfig)["description"], string>>;
type OptionsKeysAssertion = Expect<Equals<keyof ConfigurationOptions, "source">>;
type OptionsSourceAssertion = Expect<
  Equals<ConfigurationOptions["source"], Readonly<Record<string, unknown>> | undefined>
>;

// The settled contract: a declaration lowers to an ordinary provider.
const asProvider = provideConfiguration(AppConfig) satisfies Provider;

@Injectable()
class Reader {
  constructor(@Inject(AppConfig) readonly config: { port: number }) {}
}

@Module({ providers: [provideConfiguration(AppConfig), Reader] })
class ConfigModule {}

test("resolves a declared configuration through a real boot", async () => {
  const application = await AponiaFactory.create(ConfigModule, { logger: false });
  try {
    expect(application).toBeDefined();
  } finally {
    await application.close();
  }
});

void asProvider;

test("the Vite+ lane keeps a configuration declaration addressable", () => {
  const tokenTypeAssertion: TokenTypeAssertion = true;
  const tokenIdAssertion: TokenIdAssertion = true;
  const tokenDescriptionAssertion: TokenDescriptionAssertion = true;
  const optionsKeysAssertion: OptionsKeysAssertion = true;
  const optionsSourceAssertion: OptionsSourceAssertion = true;

  expect(tokenTypeAssertion).toBe(true);
  expect(tokenIdAssertion).toBe(true);
  expect(tokenDescriptionAssertion).toBe(true);
  expect(optionsKeysAssertion).toBe(true);
  expect(optionsSourceAssertion).toBe(true);
  expect(Object.isFrozen(AppConfig)).toBe(true);
  expect(typeof AppConfig.id).toBe("symbol");
  expect(AppConfig.description).toBe("configuration");
  expect(AppConfig.schema).toBeDefined();
});
