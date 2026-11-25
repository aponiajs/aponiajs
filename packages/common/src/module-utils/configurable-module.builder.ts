import type {
  DynamicModule,
  ModuleClass,
  ModuleImport,
  ModuleProvider,
} from "../interfaces/decorators.interface.ts";
import { AponiaError } from "../exceptions/aponia-error.ts";
import { normalizeProvider, provideValue } from "../providers/provider.ts";
import type { NestProvider, Provider } from "../interfaces/provider.interface.ts";
import { createToken } from "../tokens/token.ts";
import type { ClassToken, InjectionDependency, Token } from "../interfaces/token.interface.ts";
import { dynamicModule } from "../modules/module.ts";
import { moduleOptionsProviders } from "./module-async-options.ts";
import type { ModuleAsyncOptions, ModuleOptionsFactory } from "../interfaces/module.interface.ts";

/** The key a registration adds when `alwaysTransient` is set. */
export const CONFIGURABLE_MODULE_ID = "CONFIGURABLE_MODULE_ID";

const defaultMethodKey = "register";
const defaultFactoryClassMethodKey = "create";
const asyncMethodSuffix = "Async";

/** The keys specific to asynchronous registration, excluded from extras. */
const asyncOptionsKeys = Object.freeze([
  "useFactory",
  "useClass",
  "useExisting",
  "inject",
  "imports",
  "provideInjectionTokensFrom",
]);

let generatedTokenCount = 0;

/** The options the builder's constructor accepts. */
export interface ConfigurableModuleBuilderOptions {
  /** The injection token the module options are provided under. */
  readonly optionsInjectionToken?: string | symbol;
  /** Derives a descriptive token such as `CACHE_MODULE_OPTIONS`. */
  readonly moduleName?: string;
  /** Gives every registration a unique identity provider, whatever its options. */
  readonly alwaysTransient?: boolean;
}

/**
 * The contract an options-factory class implements for `useClass` and
 * `useExisting`.
 *
 * Kept as an alias so a package that named the Nest type keeps compiling.
 */
export type ConfigurableModuleOptionsFactory<
  ModuleOptions,
  FactoryClassMethodKey extends string = "create",
> = ModuleOptionsFactory<ModuleOptions, FactoryClassMethodKey>;

/**
 * What an asynchronous registration accepts.
 *
 * Mirrors Nest's `ConfigurableModuleAsyncOptions`: the union of a factory, a
 * class implementing the factory method, and an existing provider, plus the
 * internal `provideInjectionTokensFrom` list Nest's own modules use.
 */
export type ConfigurableModuleAsyncOptions<
  ModuleOptions,
  FactoryClassMethodKey extends string = "create",
> = ModuleAsyncOptions<ModuleOptions, FactoryClassMethodKey> & {
  /** Parent providers filtered down to the ones `inject` names. */
  readonly provideInjectionTokensFrom?: readonly (Provider | NestProvider)[];
};

/** The class `build()` generates: a module class with the two static factories. */
export type ConfigurableModuleClass<
  ModuleOptions,
  StaticMethodKey extends string = typeof defaultMethodKey,
  FactoryClassMethodKey extends string = typeof defaultFactoryClassMethodKey,
  Extras extends object = {},
> = {
  new (): object;
} & {
  [K in StaticMethodKey]: (options: ModuleOptions & Partial<Extras>) => DynamicModule;
} & {
  [K in `${StaticMethodKey}${typeof asyncMethodSuffix}`]: (
    options: ConfigurableModuleAsyncOptions<ModuleOptions, FactoryClassMethodKey> & Partial<Extras>,
  ) => DynamicModule;
};

/** What `build()` returns, including the two type-only members Nest publishes. */
export interface ConfigurableModuleHost<
  ModuleOptions,
  StaticMethodKey extends string,
  FactoryClassMethodKey extends string,
  Extras extends object,
> {
  /** The base class a module extends to inherit the static factories. */
  readonly ConfigurableModuleClass: ConfigurableModuleClass<
    ModuleOptions,
    StaticMethodKey,
    FactoryClassMethodKey,
    Extras
  >;
  /** The token the options are injectable under. */
  readonly MODULE_OPTIONS_TOKEN: Token<ModuleOptions>;
  /** The synchronous registration's parameter type; never a runtime value. */
  readonly OPTIONS_TYPE: ModuleOptions & Partial<Extras>;
  /** The asynchronous registration's parameter type; never a runtime value. */
  readonly ASYNC_OPTIONS_TYPE: ConfigurableModuleAsyncOptions<
    ModuleOptions,
    FactoryClassMethodKey
  > &
    Partial<Extras>;
}

/**
 * Generates the `register`/`registerAsync` pair (under any names) a configurable
 * module exposes, plus the token its options are injected through.
 *
 * Mirrors Nest's `ConfigurableModuleBuilder`:
 * [`configurable-module.builder.ts`](https://github.com/nestjs/nest/blob/master/packages/common/module-utils/configurable-module.builder.ts).
 * The generated static method registers a dynamic module holding one options
 * provider; the asynchronous method accepts a factory, a class implementing the
 * factory method, or an existing provider. `setExtras` declares options that
 * affect the module definition (such as `isGlobal`) and are deliberately absent
 * from `MODULE_OPTIONS_TOKEN`.
 *
 * The builder copies itself in every setter, as Nest's does, so a builder
 * reference a caller kept is not changed by chaining another call from it.
 *
 * @example
 * ```ts
 * const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
 *   new ConfigurableModuleBuilder<CacheOptions>()
 *     .setExtras({ isGlobal: false }, (definition, extras) => ({
 *       ...definition,
 *       global: extras.isGlobal,
 *     }))
 *     .build();
 *
 * @Module({})
 * export class CacheModule extends ConfigurableModuleClass {}
 * ```
 */
export class ConfigurableModuleBuilder<
  ModuleOptions,
  StaticMethodKey extends string = typeof defaultMethodKey,
  FactoryClassMethodKey extends string = typeof defaultFactoryClassMethodKey,
  Extras extends object = {},
> {
  /**
   * The fields are `protected` rather than `#private` because a setter returns a
   * copy and has to write the changed field on it, which a private name cannot
   * reach. Nest's own builder does the same.
   */
  protected readonly builderOptions: ConfigurableModuleBuilderOptions;
  protected staticMethodKey: string;
  protected factoryClassMethodKey: string;
  protected extras: Extras;
  protected transformModuleDefinition: (definition: DynamicModule, extras: Extras) => DynamicModule;

  constructor(
    options: ConfigurableModuleBuilderOptions = {},
    parent?: ConfigurableModuleBuilder<ModuleOptions, string, string, object>,
  ) {
    // A builder derived from another shares its options object, so a token
    // settled by `build()` stays the same across the chain.
    this.builderOptions = parent === undefined ? { ...options } : parent.builderOptions;
    this.staticMethodKey = parent?.staticMethodKey ?? defaultMethodKey;
    this.factoryClassMethodKey = parent?.factoryClassMethodKey ?? defaultFactoryClassMethodKey;
    this.extras = (parent?.extras ?? {}) as Extras;
    this.transformModuleDefinition = (parent?.transformModuleDefinition ??
      ((definition) => definition)) as (definition: DynamicModule, extras: Extras) => DynamicModule;
  }

  /**
   * Names the static registration method; the asynchronous method is `<name>Async`.
   *
   * @param name - The static method name.
   * @returns A builder typed with the new name.
   */
  setClassMethodName<const Name extends string>(
    name: Name,
  ): ConfigurableModuleBuilder<ModuleOptions, Name, FactoryClassMethodKey, Extras> {
    const builder = new ConfigurableModuleBuilder<
      ModuleOptions,
      Name,
      FactoryClassMethodKey,
      Extras
    >(
      this.builderOptions,
      this as unknown as ConfigurableModuleBuilder<ModuleOptions, string, string, object>,
    );
    builder.staticMethodKey = name;
    return builder;
  }

  /**
   * Names the method an options-factory class implements.
   *
   * @param name - The factory method name; defaults to `create`.
   * @returns A builder typed with the new method name.
   */
  setFactoryMethodName<const Name extends string>(
    name: Name,
  ): ConfigurableModuleBuilder<ModuleOptions, StaticMethodKey, Name, Extras> {
    const builder = new ConfigurableModuleBuilder<ModuleOptions, StaticMethodKey, Name, Extras>(
      this.builderOptions,
      this as unknown as ConfigurableModuleBuilder<ModuleOptions, string, string, object>,
    );
    builder.factoryClassMethodKey = name;
    return builder;
  }

  /**
   * Declares options every registration supplies and the definition transform.
   *
   * The extras are omitted from `MODULE_OPTIONS_TOKEN`; the transform receives
   * the generated definition and the merged extras, and returns the definition
   * the application imports.
   *
   * @param extras - The default extras.
   * @param transformDefinition - Applies the extras to the definition.
   * @returns A builder typed with the extras.
   */
  setExtras<Extra extends object>(
    extras: Extra,
    transformDefinition: (definition: DynamicModule, extras: Extra) => DynamicModule = (
      definition,
    ) => definition,
  ): ConfigurableModuleBuilder<ModuleOptions, StaticMethodKey, FactoryClassMethodKey, Extra> {
    const builder = new ConfigurableModuleBuilder<
      ModuleOptions,
      StaticMethodKey,
      FactoryClassMethodKey,
      Extra
    >(
      this.builderOptions,
      this as unknown as ConfigurableModuleBuilder<ModuleOptions, string, string, object>,
    );
    builder.extras = extras;
    builder.transformModuleDefinition = transformDefinition;
    return builder;
  }

  /**
   * Generates the module class, the options token, and the two type markers.
   *
   * @returns The module class plus its options token and type-only members.
   */
  build(): ConfigurableModuleHost<ModuleOptions, StaticMethodKey, FactoryClassMethodKey, Extras> {
    const token = resolveOptionsToken<ModuleOptions>(this.builderOptions);
    const staticMethodKey = this.staticMethodKey;
    const factoryMethodKey = `${staticMethodKey}${asyncMethodSuffix}`;
    const factoryClassMethodKey = this.factoryClassMethodKey;
    const extras = this.extras;
    const transform = this.transformModuleDefinition;
    const alwaysTransient = this.builderOptions.alwaysTransient === true;

    const Generated = class ConfigurableModuleClass {
      static [staticMethodKey](options: ModuleOptions & Partial<Extras>): DynamicModule {
        const providers: Provider[] = [
          provideValue(token, omitExtras(options, extras) as ModuleOptions),
        ];
        if (alwaysTransient) {
          providers.push(provideValue(CONFIGURABLE_MODULE_ID, Symbol("CONFIGURABLE_MODULE_ID")));
        }
        return transform(dynamicModule({ module: this as unknown as ModuleClass, providers }), {
          ...extras,
          ...options,
        } as Extras);
      }

      static [factoryMethodKey](
        options: ConfigurableModuleAsyncOptions<ModuleOptions, FactoryClassMethodKey> &
          Partial<Extras>,
      ): DynamicModule {
        const providers = createAsyncProviders(
          token,
          options,
          factoryClassMethodKey,
          factoryMethodKey,
        );
        if (alwaysTransient) {
          providers.push(provideValue(CONFIGURABLE_MODULE_ID, Symbol("CONFIGURABLE_MODULE_ID")));
        }
        return transform(
          dynamicModule({
            module: this as unknown as ModuleClass,
            imports: options.imports ?? [],
            providers,
          }),
          { ...extras, ...extractExtras(options, extras) } as Extras,
        );
      }
    };

    const host: ConfigurableModuleHost<
      ModuleOptions,
      StaticMethodKey,
      FactoryClassMethodKey,
      Extras
    > = {
      ConfigurableModuleClass: Generated as unknown as ConfigurableModuleClass<
        ModuleOptions,
        StaticMethodKey,
        FactoryClassMethodKey,
        Extras
      >,
      MODULE_OPTIONS_TOKEN: token,
      OPTIONS_TYPE: createTypeProxy("OPTIONS_TYPE") as ModuleOptions & Partial<Extras>,
      ASYNC_OPTIONS_TYPE: createTypeProxy("ASYNC_OPTIONS_TYPE") as ConfigurableModuleAsyncOptions<
        ModuleOptions,
        FactoryClassMethodKey
      > &
        Partial<Extras>,
    };
    return Object.freeze(host);
  }
}

/** The token the options are provided under, derived per Nest's rules. */
function resolveOptionsToken<TOptions>(options: ConfigurableModuleBuilderOptions): Token<TOptions> {
  if (options.optionsInjectionToken !== undefined) {
    return createToken<TOptions>(String(options.optionsInjectionToken));
  }
  const moduleName = options.moduleName;
  if (moduleName !== undefined) {
    const snake = moduleName
      .trim()
      .split(/(?=[A-Z])/)
      .join("_")
      .toUpperCase();
    return createToken<TOptions>(`${snake}_MODULE_OPTIONS`);
  }
  generatedTokenCount += 1;
  return createToken<TOptions>(`CONFIGURABLE_MODULE_OPTIONS[${String(generatedTokenCount)}]`);
}

/** Creates the providers an asynchronous registration contributes. */
function createAsyncProviders<ModuleOptions>(
  token: Token<unknown>,
  options: ConfigurableModuleAsyncOptions<ModuleOptions, string>,
  factoryClassMethodKey: string,
  factoryMethodKey: string,
): Provider[] {
  if (!("useFactory" in options) && !("useClass" in options) && !("useExisting" in options)) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      "A configurable module registration needs useFactory, useClass, or useExisting.",
      { registration: factoryMethodKey },
    );
  }

  const providers = [
    ...moduleOptionsProviders(
      token as Token<ModuleOptions>,
      options,
      (resolved) => resolved,
      factoryClassMethodKey,
    ),
  ];

  if (
    "useFactory" in options &&
    options.inject !== undefined &&
    options.provideInjectionTokensFrom !== undefined
  ) {
    providers.push(...getInjectionProviders(options.provideInjectionTokensFrom, options.inject));
  }

  return providers;
}

/** Returns the providers a `provideInjectionTokensFrom` list contributes. */
function getInjectionProviders(
  providers: readonly (Provider | NestProvider)[],
  inject: readonly InjectionDependency[],
): Provider[] {
  const normalized = providers.map((provider) => normalizeProvider(provider));
  const selected: Provider[] = [];
  let search = new Set<unknown>(
    inject.map((dependency) =>
      typeof dependency === "object" &&
      dependency !== null &&
      "token" in dependency &&
      "optional" in dependency
        ? (dependency as { readonly token: unknown }).token
        : dependency,
    ),
  );

  while (search.size > 0) {
    const matches = normalized.filter(
      (provider) => !selected.includes(provider) && search.has(provider.provide),
    );
    selected.push(...matches);
    search = new Set(
      matches.flatMap((provider) =>
        provider.kind === "alias"
          ? [provider.useExisting]
          : provider.kind === "factory"
            ? provider.inject
            : [],
      ),
    );
  }

  return selected;
}

/** Removes the extras from the sync options before they reach the token. */
function omitExtras<ModuleOptions extends object>(
  options: ModuleOptions,
  extras: object,
): ModuleOptions {
  const extraKeys = new Set(Object.keys(extras));
  if (extraKeys.size === 0 || typeof options !== "object" || options === null) {
    return options;
  }

  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !extraKeys.has(key)),
  ) as ModuleOptions;
}

/** Reads the extras an asynchronous registration stated beside its factory. */
function extractExtras(options: object, extras: object): object {
  if (Object.keys(extras).length === 0) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !asyncOptionsKeys.includes(key)),
  );
}

/** A type marker that refuses to be read as a value, exactly as Nest's does. */
function createTypeProxy(typeName: string): unknown {
  return new Proxy(
    {},
    {
      get: () => {
        throw new Error(`"${typeName}" is not supposed to be used as a value.`);
      },
    },
  );
}

/** The declarations `forFeature` accepts. */
export interface FeatureModuleOptions {
  /** Distinguishes two feature registrations of one module. */
  readonly name?: string;
  /** The providers this feature contributes. */
  readonly providers: readonly Provider[];
  /** The imports those providers resolve against. */
  readonly imports?: readonly ModuleImport[];
  /** The tokens the feature exports; defaults to every provider token. */
  readonly exports?: readonly Token<unknown>[];
  /** Whether the exports are visible without an import. */
  readonly global?: boolean;
}

/**
 * Declares one feature registration of a module, as Nest's packages spell
 * `forFeature`.
 *
 * A feature registration is a dynamic module holding the given providers and
 * export list, keyed apart from other registrations of the same class by
 * `name`.
 *
 * @param module - The module class the registration hangs off.
 * @param options - The providers, imports, exports, and instance name.
 * @returns The feature's dynamic module.
 *
 * @example
 * ```ts
 * @Module({ imports: [forFeature(UsersModule, { providers: [UsersRepository] })] })
 * class AppModule {}
 * ```
 */
export function forFeature(
  module: ClassToken<unknown>,
  options: FeatureModuleOptions,
): DynamicModule {
  const name = options.name ?? "default";
  return dynamicModule({
    module,
    id: `${module.name}[feature:${name}]`,
    instanceId: Symbol.for(`aponia.feature:${module.name}:${name}`),
    ...(options.global === undefined ? {} : { global: options.global }),
    imports: options.imports ?? [],
    providers: options.providers as readonly ModuleProvider[],
    exports: options.exports ?? options.providers.map((provider) => provider.provide),
  });
}
