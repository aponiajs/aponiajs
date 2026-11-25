import {
  AponiaError,
  Module,
  provideAlias,
  provideClass,
  provideFactory,
  withModuleProviders,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { CacheService } from "./cache.service.ts";
import { CacheInterceptor } from "./interceptors/cache.interceptor.ts";
import { MemoryCacheStore } from "./memory-cache.store.ts";
import { CACHE_MANAGER, CACHE_OPTIONS, CACHE_STORE } from "./cache.constants.ts";
import type {
  CacheModuleOptions,
  RegistrationCacheOptions,
} from "./interfaces/cache-module.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type CacheModuleExtras,
  type CacheModuleRegistrationAsyncOptions,
  type CacheModuleSyncOptions,
} from "./cache.module-definition.ts";

const defaultMaxEntries = 1_000;

/**
 * Provides the cache service, its store, and the `@nestjs/cache-manager`
 * compatible `CACHE_MANAGER` alias.
 *
 * The registration is one module: the store, the resolved options, and the
 * service live together, so `application.get(CacheService)` reads the cache the
 * application declared. Two registrations are distinct modules; an application
 * normally declares one.
 *
 * `register`/`registerAsync` are the generated Nest-shaped names; `forRoot` and
 * `forRootAsync` are the canonical Aponia names and answer the same definitions.
 */
@Module({})
export class CacheModule extends ConfigurableModuleClass {
  /**
   * Builds a cache registration.
   *
   * @param options - The store, default TTL, entry cap, key prefix, and global flag.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE` when an option is invalid.
   */
  static forRoot(options: CacheModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return complete(super.register(options));
  }

  /**
   * Builds a cache registration whose options a factory, a class, or an existing
   * provider resolves.
   *
   * The async option is resolved once, when the options token first resolves; its
   * result is validated then, so a refused boot names the same issues `forRoot`
   * reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: CacheModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return complete(super.registerAsync(options), options.extraProviders);
  }

  /**
   * Builds a cache registration.
   *
   * @deprecated Use {@link CacheModule.forRoot}; retained for the beta line.
   */
  static override register(options: CacheModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return complete(super.register(options));
  }

  /**
   * Builds a cache registration whose options a factory resolves.
   *
   * @deprecated Use {@link CacheModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(options: CacheModuleRegistrationAsyncOptions): DynamicModule {
    return CacheModule.forRootAsync(options);
  }
}

function complete(
  definition: DynamicModule,
  extraProviders: readonly Provider[] | undefined = [],
): DynamicModule {
  const withProviders = withModuleProviders(
    Object.freeze({
      ...definition,
      imports: Object.freeze([...(definition.imports ?? [])]),
      controllers: Object.freeze([...(definition.controllers ?? [])]),
      providers: Object.freeze([...(definition.providers ?? [])]),
      exports: Object.freeze([...(definition.exports ?? [])]),
    }),
    extraProviders,
  );

  return Object.freeze({
    ...withProviders,
    module: CacheModule,
    providers: Object.freeze([
      ...(withProviders.providers ?? []),
      provideFactory(CACHE_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: CacheModuleOptions) =>
        resolveOptions(options),
      ),
      provideFactory(
        CACHE_STORE,
        [CACHE_OPTIONS],
        (options: RegistrationCacheOptions) =>
          options.store ?? new MemoryCacheStore({ maxEntries: options.maxEntries }),
      ),
      provideClass(CacheService, [CACHE_STORE, CACHE_OPTIONS]),
      provideAlias(CACHE_MANAGER, CacheService),
      provideClass(CacheInterceptor, [CACHE_MANAGER]),
    ]),
    exports: Object.freeze([
      MODULE_OPTIONS_TOKEN,
      CACHE_OPTIONS,
      CACHE_STORE,
      CACHE_MANAGER,
      CacheService,
      CacheInterceptor,
    ]),
  });
}

function assertExtras(options: Partial<CacheModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      "The cache registration is invalid: isGlobal must be a boolean.",
      { configuration: "cache", issues: Object.freeze(["isGlobal must be a boolean"]) },
    );
  }
}

function resolveOptions(options: CacheModuleOptions): RegistrationCacheOptions {
  const ttlMs = options.ttlMs;
  const maxEntries = options.maxEntries ?? defaultMaxEntries;
  const keyPrefix = options.keyPrefix ?? "";
  const issues: string[] = [];

  if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
    issues.push("ttlMs must be a positive finite number");
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    issues.push("maxEntries must be a positive integer");
  }
  if (typeof keyPrefix !== "string") {
    issues.push("keyPrefix must be a string");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      `The cache registration is invalid: ${issues.join("; ")}.`,
      { configuration: "cache", issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({ ttlMs, maxEntries, keyPrefix, store: options.store });
}
