import type { InjectionToken, ModuleMetadata, Provider, RouteValidator } from "@aponiajs/common";

/** Plain record holding configuration keys and nested namespace objects. */
export type ConfigObject = Record<string, unknown>;

/** Factory function returning a configuration object or Promise of one. */
export type ConfigFactory<T extends ConfigObject = ConfigObject> = () => T | Promise<T>;

/** Metadata attached to a namespaced factory created by `registerAs`. */
export interface ConfigFactoryKeyHost<T extends ConfigObject = ConfigObject> {
  /** Injection token (`CONFIGURATION(<namespace>)`). */
  readonly KEY: string;
  /** Returns a Nest-compatible `FactoryProvider` registering this namespace. */
  asProvider(): Provider;
  /** Executes the underlying factory. */
  (): T | Promise<T>;
}

/** Options accepted by `ConfigModule.forRoot()`. */
export interface ConfigModuleOptions {
  /** Registers `ConfigModule` as a global module. */
  readonly isGlobal?: boolean;
  /** Ignores `.env` file loading when `true`. */
  readonly ignoreEnvFile?: boolean;
  /** Ignores `process.env` variables when `true`. */
  readonly ignoreEnvVars?: boolean;
  /** Path or ordered list of paths to `.env` files (default: `.env`). */
  readonly envFilePath?: string | readonly string[];
  /** Custom encoding used when reading `.env` files (default: `"utf8"`). */
  readonly encoding?: BufferEncoding;
  /** Custom synchronous validation/transform function for loaded environment variables. */
  readonly validate?: (config: ConfigObject) => ConfigObject;
  /** Standard Schema (`~standard`) or TypeBox `ValidatorSchema` validating environment variables. */
  readonly validationSchema?: RouteValidator;
  /** Array of configuration factories (including `registerAs` factories) to merge into config. */
  readonly load?: readonly ConfigFactory[];
  /** Expands `${VAR}` and `${VAR:-default}` references inside `.env` values when `true`. */
  readonly expandVariables?: boolean;
  /** Caches `ConfigService.get()` lookups when `true`. */
  readonly cache?: boolean;
  /** Skips assigning parsed `.env` keys onto `process.env` when `true`. */
  readonly skipProcessEnv?: boolean;
}

/** Options accepted by `ConfigModule.forRootAsync()`. */
export interface ConfigModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  /** Registers `ConfigModule` as a global module. */
  readonly isGlobal?: boolean;
  /** Factory returning `ConfigModuleOptions`. */
  readonly useFactory: (
    ...args: readonly never[]
  ) => ConfigModuleOptions | Promise<ConfigModuleOptions>;
  /** Tokens injected into `useFactory`. */
  readonly inject?: readonly InjectionToken<unknown>[];
}
