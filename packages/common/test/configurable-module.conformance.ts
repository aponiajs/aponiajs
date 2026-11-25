import {
  ConfigurableModuleBuilder,
  forFeature,
  type DynamicModule,
  type Provider,
  type Token,
} from "@aponiajs/common";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

interface CacheOptions {
  readonly port: number;
}

function optionsProvider(registration: DynamicModule, token: Token<unknown>): Provider {
  const provider = (registration.providers ?? []).find(
    (entry): entry is Provider =>
      typeof entry === "object" && entry !== null && "kind" in entry && entry.provide === token,
  );
  if (provider === undefined) {
    throw new Error("expected an options provider");
  }
  return provider;
}

test("the generated class registers its options under one token", () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();

  const registration = ConfigurableModuleClass.register({ port: 3000 });
  const provider = optionsProvider(registration, MODULE_OPTIONS_TOKEN);

  expect(provider.kind).toBe("value");
  // Nest's generated registration provides the options token and exports it to
  // no importer; the host module reads it through its own providers.
  expect(registration.exports).toBeUndefined();
});

test("a renamed generated class exposes forRoot and forRootAsync", () => {
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>()
    .setClassMethodName("forRoot")
    .build();

  expect(typeof ConfigurableModuleClass.forRoot).toBe("function");
  expect(typeof ConfigurableModuleClass.forRootAsync).toBe("function");
});

test("an async registration accepts a factory class and an existing provider", () => {
  const host = new ConfigurableModuleBuilder<CacheOptions>().build();

  class OptionsFactory {
    create(): CacheOptions {
      return { port: 1 };
    }
  }

  const byClass = host.ConfigurableModuleClass.registerAsync({ useClass: OptionsFactory });
  const byExisting = host.ConfigurableModuleClass.registerAsync({ useExisting: OptionsFactory });

  expect(
    (byClass.providers ?? []).some(
      (entry) =>
        typeof entry === "object" && "useClass" in entry && entry.useClass === OptionsFactory,
    ),
  ).toBe(true);
  // `useExisting` points at a provider the importer supplies; it must not be
  // registered a second time by the generated module.
  expect(byExisting.providers?.length).toBe(1);
});

test("forFeature keys one named registration", () => {
  class UsersModule {}

  const registration = forFeature(UsersModule, { providers: [], name: "admin" });

  expect(registration.id).toBe("UsersModule[feature:admin]");
  expect(registration.instanceId).toBe(Symbol.for("aponia.feature:UsersModule:admin"));
});
