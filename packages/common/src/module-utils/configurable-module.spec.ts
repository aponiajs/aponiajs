import { expect, test } from "bun:test";
import {
  ConfigurableModuleBuilder,
  CONFIGURABLE_MODULE_ID,
  Injectable,
  createToken,
  forFeature,
  moduleOptionsProviders,
  optionalDependency,
  provideAlias,
  provideFactory,
  provideValue,
  withModuleProviders,
  type DynamicModule,
  type Provider,
  type Token,
} from "../index.ts";

interface CacheOptions {
  readonly port: number;
  readonly isGlobal?: boolean;
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

test("generates register and registerAsync with one options token", () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();

  const registration = ConfigurableModuleClass.register({ port: 3000 });
  const provider = optionsProvider(registration, MODULE_OPTIONS_TOKEN);

  expect(provider.kind).toBe("value");
  expect(provider.provide).toBe(MODULE_OPTIONS_TOKEN);
  expect(registration.exports).toBeUndefined();
  expect(typeof ConfigurableModuleClass.registerAsync).toBe("function");
});

test("renames the static method and derives the async name", () => {
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>()
    .setClassMethodName("forRoot")
    .build();

  expect(typeof ConfigurableModuleClass.forRoot).toBe("function");
  expect(typeof ConfigurableModuleClass.forRootAsync).toBe("function");
});

test("builds an async factory provider that resolves the caller's options", async () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();

  const registration = ConfigurableModuleClass.registerAsync({
    useFactory: () => ({ port: 4000 }),
  });
  const provider = optionsProvider(registration, MODULE_OPTIONS_TOKEN);

  expect(provider.kind).toBe("factory");
  if (provider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  expect(await provider.useFactory()).toEqual({ port: 4000 });
});

test("accepts a factory that returns a Promise for its options", async () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();

  const registration = ConfigurableModuleClass.registerAsync({
    useFactory: async () => ({ port: 4100 }),
  });
  const provider = optionsProvider(registration, MODULE_OPTIONS_TOKEN);

  if (provider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  expect(await provider.useFactory()).toEqual({ port: 4100 });
});

test("setExtras transforms the definition and keeps extras out of the options", () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>()
      .setExtras({ isGlobal: false }, (definition, extras) => ({
        ...definition,
        global: extras.isGlobal,
      }))
      .build();

  const registration = ConfigurableModuleClass.register({ port: 5000, isGlobal: true });
  const provider = optionsProvider(registration, MODULE_OPTIONS_TOKEN);

  expect(registration.global).toBe(true);
  expect(provider.kind).toBe("value");
  if (provider.kind === "value") {
    expect(provider.useValue).toEqual({ port: 5000 });
  }
});

test("default extras do not leak into the options token", () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().setExtras({ isGlobal: true }).build();

  const provider = optionsProvider(
    ConfigurableModuleClass.register({ port: 7000 }),
    MODULE_OPTIONS_TOKEN,
  );

  expect(provider.kind).toBe("value");
  if (provider.kind === "value") {
    expect(provider.useValue).toEqual({ port: 7000 });
  }
});

test("builds a useClass registration that awaits the factory method", async () => {
  class OptionsFactory {
    create(): CacheOptions {
      return { port: 6000 };
    }
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();
  const registration = ConfigurableModuleClass.registerAsync({ useClass: OptionsFactory });
  const provider = optionsProvider(registration, MODULE_OPTIONS_TOKEN);

  expect(registration.providers?.some((entry) => entry === OptionsFactory)).toBe(false);
  expect(
    (registration.providers ?? []).some(
      (entry) =>
        typeof entry === "object" && "useClass" in entry && entry.useClass === OptionsFactory,
    ),
  ).toBe(true);

  if (provider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  expect(
    await (provider.useFactory as (instance: unknown) => unknown)(new OptionsFactory()),
  ).toEqual({ port: 6000 });
});

test("refuses an async registration with no factory shape", () => {
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>().build();

  expect(() => ConfigurableModuleClass.registerAsync({} as never)).toThrow(
    expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
  );
});

test("publishes OPTIONS_TYPE and ASYNC_OPTIONS_TYPE markers that refuse use", () => {
  const host = new ConfigurableModuleBuilder<CacheOptions>().build();

  expect(() => (host.OPTIONS_TYPE as unknown as { port: number }).port).toThrow(
    '"OPTIONS_TYPE" is not supposed to be used as a value.',
  );
  expect(() => (host.ASYNC_OPTIONS_TYPE as unknown as { useFactory: unknown }).useFactory).toThrow(
    '"ASYNC_OPTIONS_TYPE" is not supposed to be used as a value.',
  );
});

test("an extending module class is the registration's identity", () => {
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>().build();

  class CacheModule extends ConfigurableModuleClass {}

  expect(CacheModule.register({ port: 1 }).module).toBe(CacheModule);
  expect(CacheModule.registerAsync({ useFactory: () => ({ port: 1 }) }).module).toBe(CacheModule);
});

test("a setter returns a copy rather than changing the builder it came from", () => {
  const base = new ConfigurableModuleBuilder<CacheOptions>();
  const renamed = base.setClassMethodName("forRoot");

  const original = base.build().ConfigurableModuleClass as unknown as Record<string, unknown>;
  const derived = renamed.build().ConfigurableModuleClass as unknown as Record<string, unknown>;

  expect(typeof original.register).toBe("function");
  expect(original.forRoot).toBeUndefined();
  expect(typeof derived.forRoot).toBe("function");
});

test("reads a renamed factory method from a useClass instance", async () => {
  class Factory {
    createOptions(): CacheOptions {
      return { port: 8000 };
    }
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().setFactoryMethodName("createOptions").build();
  const provider = optionsProvider(
    ConfigurableModuleClass.registerAsync({ useClass: Factory }),
    MODULE_OPTIONS_TOKEN,
  );

  if (provider.kind === "factory") {
    expect(await (provider.useFactory as (instance: unknown) => unknown)(new Factory())).toEqual({
      port: 8000,
    });
  }
});

test("refuses a useClass instance without the factory method", async () => {
  class NoFactory {}

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();
  const provider = optionsProvider(
    ConfigurableModuleClass.registerAsync({ useClass: NoFactory as never }),
    MODULE_OPTIONS_TOKEN,
  );

  if (provider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  let failure: unknown;
  try {
    await (provider.useFactory as (instance: unknown) => unknown)(new NoFactory());
  } catch (error) {
    failure = error;
  }
  expect(failure).toEqual(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
});

test("reads options from an existing provider", async () => {
  class Existing {
    create(): CacheOptions {
      return { port: 9000 };
    }
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();
  const provider = optionsProvider(
    ConfigurableModuleClass.registerAsync({ useExisting: Existing }),
    MODULE_OPTIONS_TOKEN,
  );

  if (provider.kind === "factory") {
    expect(await (provider.useFactory as (instance: unknown) => unknown)(new Existing())).toEqual({
      port: 9000,
    });
  }
});

test("moduleOptionsProviders infers a factory class's constructor dependencies", () => {
  const TOKEN = createToken<CacheOptions>("async.useClass");

  @Injectable()
  class OptionsSource {}

  @Injectable()
  class OptionsFactory {
    constructor(readonly source: OptionsSource) {}

    create(): CacheOptions {
      return { port: 6100 };
    }
  }

  const providers = moduleOptionsProviders(TOKEN, { useClass: OptionsFactory });
  const classProvider = providers.find(
    (entry) => entry.kind === "class" && entry.provide === OptionsFactory,
  );

  expect(classProvider?.kind).toBe("class");
  if (classProvider?.kind === "class") {
    expect(classProvider.inject).toEqual([OptionsSource]);
  }
});

test("moduleOptionsProviders aliases an existing options provider without registering it twice", () => {
  const TOKEN = createToken<CacheOptions>("async.useExisting");

  class ExistingFactory {
    create(): CacheOptions {
      return { port: 6200 };
    }
  }

  const providers = moduleOptionsProviders(TOKEN, { useExisting: ExistingFactory });

  expect(providers).toHaveLength(1);
  expect(providers[0]?.kind).toBe("factory");
});

test("moduleOptionsProviders refuses a registration with no factory shape", () => {
  const TOKEN = createToken<CacheOptions>("async.empty");

  expect(() => moduleOptionsProviders(TOKEN, {} as never)).toThrow(
    expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
  );
});

test("forFeature declares one named feature registration", () => {
  class UsersModule {}
  class OtherModule {}

  const registration = forFeature(UsersModule, {
    name: "admin",
    providers: [],
    global: false,
  });

  expect(registration.module).toBe(UsersModule);
  expect(registration.id).toBe("UsersModule[feature:admin]");
  expect(registration.instanceId).toBe(Symbol.for("aponia.feature:UsersModule:admin"));
  expect(registration.exports).toEqual([]);
  expect(forFeature(OtherModule, { providers: [] }).id).toBe("OtherModule[feature:default]");
});

test("forFeature defaults its name and exports every provider token", () => {
  const TOKEN = createToken<number>("feature.token");
  class FeatureModule {}

  const registration = forFeature(FeatureModule, { providers: [provideValue(TOKEN, 1)] });

  expect(registration.id).toBe("FeatureModule[feature:default]");
  expect(registration.exports).toEqual([TOKEN]);
});

test("alwaysTransient gives every registration its own identity provider", () => {
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>({
    alwaysTransient: true,
  }).build();

  const first = ConfigurableModuleClass.register({ port: 1 });
  const second = ConfigurableModuleClass.register({ port: 2 });
  const asynchronous = ConfigurableModuleClass.registerAsync({
    useFactory: () => ({ port: 3 }),
  });

  const identity = (registration: DynamicModule) => {
    const provider = (registration.providers ?? []).find(
      (entry): entry is Provider =>
        typeof entry === "object" &&
        entry !== null &&
        "kind" in entry &&
        entry.kind === "value" &&
        entry.provide === CONFIGURABLE_MODULE_ID,
    );
    if (provider?.kind !== "value") {
      throw new Error("expected an identity provider");
    }
    return provider.useValue;
  };

  expect(identity(first)).not.toBe(identity(second));
  expect(identity(asynchronous)).toBeDefined();
});

test("derives the options token from an explicit token or a module name", () => {
  const explicit = new ConfigurableModuleBuilder<CacheOptions>({
    optionsInjectionToken: "CUSTOM_OPTIONS",
  }).build();
  const named = new ConfigurableModuleBuilder<CacheOptions>({ moduleName: "Cache" }).build();

  expect((explicit.MODULE_OPTIONS_TOKEN as { readonly description: string }).description).toBe(
    "CUSTOM_OPTIONS",
  );
  expect((named.MODULE_OPTIONS_TOKEN as { readonly description: string }).description).toBe(
    "CACHE_MODULE_OPTIONS",
  );
});

test("provideInjectionTokensFrom carries the providers an inject chain names", () => {
  const SOURCE = createToken<number>("injection.source");
  const DERIVED = createToken<string>("injection.derived");
  const ALIAS = createToken<number>("injection.alias");
  const UNRELATED = createToken<boolean>("injection.unrelated");

  const source = provideValue(SOURCE, 1);
  const derived = provideFactory(DERIVED, [SOURCE], (value) => String(value));
  const alias = provideAlias(ALIAS, SOURCE);
  const unrelated = provideValue(UNRELATED, true);

  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>().build();
  const registration = ConfigurableModuleClass.registerAsync({
    useFactory: () => ({ port: 5000 }),
    inject: [optionalDependency(ALIAS), DERIVED],
    provideInjectionTokensFrom: [source, derived, alias, unrelated],
  });

  expect(registration.providers).toContain(source);
  expect(registration.providers).toContain(derived);
  expect(registration.providers).toContain(alias);
  expect(registration.providers).not.toContain(unrelated);
});

test("an asynchronous registration merges its extras before the transform runs", () => {
  const seen: Array<{ readonly isGlobal?: boolean }> = [];
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => {
      seen.push(extras);
      return { ...definition, global: extras.isGlobal };
    })
    .build();

  const registration = ConfigurableModuleClass.registerAsync({
    useFactory: () => ({ port: 6000 }),
    isGlobal: true,
  });

  expect(seen).toEqual([{ isGlobal: true }]);
  expect(registration.global).toBe(true);
});

test("a synchronous registration keeps a non-object options value as it was stated", () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<CacheOptions>().build();

  const registration = ConfigurableModuleClass.register(null as never);

  expect(optionsProvider(registration, MODULE_OPTIONS_TOKEN)).toEqual(
    expect.objectContaining({ kind: "value", useValue: null }),
  );
});

test("withModuleProviders appends and freezes without mutating the registration", () => {
  const token = createToken<string>("with.providers");
  const { ConfigurableModuleClass } = new ConfigurableModuleBuilder<CacheOptions>().build();
  const registration = ConfigurableModuleClass.register({ port: 7000 });
  const provider = provideValue(token, "extra");

  expect(withModuleProviders(registration, undefined)).toBe(registration);
  expect(withModuleProviders(registration, [])).toBe(registration);

  const appended = withModuleProviders(registration, [provider]);
  expect(appended).not.toBe(registration);
  expect(appended.providers).toContain(provider);
  expect(Object.isFrozen(appended)).toBe(true);
  expect(Object.isFrozen(appended.providers)).toBe(true);
  expect(registration.providers).not.toContain(provider);
});
