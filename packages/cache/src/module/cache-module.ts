import {
  AponiaError,
  Module,
  provideClass,
  provideValue,
  type DynamicModule,
} from "@aponiajs/common";
import { CacheService } from "../service/cache-service.ts";
import { MemoryCacheStore } from "../store/memory-cache-store.ts";
import { CACHE_OPTIONS, CACHE_STORE } from "./cache-module.constants.ts";
import type { CacheModuleOptions, ResolvedCacheOptions } from "./cache-module.types.ts";

const defaultTtlMs = 60_000;
const defaultMaxEntries = 1_000;

/**
 * Provides the cache service and its store.
 *
 * The registration is one module: the store, the resolved options, and the
 * service live together, so `application.get(CacheService)` reads the cache the
 * application declared. Two registrations are distinct modules; an application
 * normally declares one.
 */
@Module({})
export class CacheModule {
  /**
   * Builds a cache registration.
   *
   * @param options - The store, default TTL, entry cap, and key prefix.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE` when an option is invalid.
   */
  static register(options: CacheModuleOptions = {}): DynamicModule {
    const resolved = resolveOptions(options);
    const store = options.store ?? new MemoryCacheStore({ maxEntries: resolved.maxEntries });

    return Object.freeze({
      module: CacheModule,
      id: "CacheModule",
      instanceId: Symbol("CacheModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(CACHE_STORE, store),
        provideValue(CACHE_OPTIONS, resolved),
        provideClass(CacheService, [CACHE_STORE, CACHE_OPTIONS]),
      ]),
      exports: Object.freeze([CacheService, CACHE_STORE]),
    });
  }
}

function resolveOptions(options: CacheModuleOptions): ResolvedCacheOptions {
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const maxEntries = options.maxEntries ?? defaultMaxEntries;
  const keyPrefix = options.keyPrefix ?? "";
  const issues: string[] = [];

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
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

  return Object.freeze({ ttlMs, maxEntries, keyPrefix });
}
