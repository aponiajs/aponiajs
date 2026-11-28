import {
  AponiaError,
  Module,
  provideFactory,
  provideRequestLifecycleHooksAsync,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { createIdempotencyLifecycleHook } from "./idempotency-lifecycle.provider.ts";
import { IDEMPOTENCY_OPTIONS, IDEMPOTENCY_STORE } from "./idempotency.constants.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type IdempotencyModuleRegistrationAsyncOptions,
  type IdempotencyModuleSyncOptions,
} from "./idempotency.module-definition.ts";
import type {
  IdempotencyModuleOptions,
  IdempotencyStore,
  ResolvedIdempotencyOptions,
} from "./interfaces/idempotency-store.interface.ts";
import { MemoryIdempotencyStore } from "./store/memory-idempotency.store.ts";

const defaultMethods = ["POST", "PUT", "PATCH"] as const;
const defaultTtlMs = 86_400_000;
const defaultMaxKeys = 10_000;

interface RegistrationIdempotencyOptions extends ResolvedIdempotencyOptions {
  readonly store?: IdempotencyStore;
}

/**
 * Registers `Idempotency-Key` deduplication and response replay.
 */
@Module({})
export class IdempotencyModule extends ConfigurableModuleClass {
  static forRoot(options: IdempotencyModuleSyncOptions = {}): DynamicModule {
    resolveIdempotencyOptions(options);
    return registration(super.register(options));
  }

  static forRootAsync(options: IdempotencyModuleRegistrationAsyncOptions): DynamicModule {
    return registration(super.registerAsync(options), options.extraProviders);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: IdempotencyModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(
        IDEMPOTENCY_OPTIONS,
        [MODULE_OPTIONS_TOKEN],
        (options: IdempotencyModuleOptions) => ({
          ...resolveIdempotencyOptions(options),
          store: options.store,
        }),
      ),
      provideFactory(
        IDEMPOTENCY_STORE,
        [IDEMPOTENCY_OPTIONS],
        (options: RegistrationIdempotencyOptions) =>
          options.store ?? new MemoryIdempotencyStore(options.maxKeys),
      ),
      provideRequestLifecycleHooksAsync(
        [IDEMPOTENCY_OPTIONS, IDEMPOTENCY_STORE],
        (options, store) => createIdempotencyLifecycleHook(options, store),
      ),
      ...extraProviders,
    ]),
    exports: Object.freeze([
      ...(definition.exports ?? []),
      MODULE_OPTIONS_TOKEN,
      IDEMPOTENCY_STORE,
    ]),
  });
}

function resolveIdempotencyOptions(options: IdempotencyModuleOptions): ResolvedIdempotencyOptions {
  const headerName = (options.headerName ?? "idempotency-key").toLowerCase();
  if (headerName.trim() === "") {
    throw new AponiaError("INVALID_IDEMPOTENCY_OPTIONS", "headerName must be a non-empty string.", {
      status: 500,
    });
  }
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new AponiaError("INVALID_IDEMPOTENCY_OPTIONS", "ttlMs must be a positive integer.", {
      status: 500,
    });
  }
  const maxKeys = options.maxKeys ?? defaultMaxKeys;
  if (!Number.isInteger(maxKeys) || maxKeys <= 0) {
    throw new AponiaError("INVALID_IDEMPOTENCY_OPTIONS", "maxKeys must be a positive integer.", {
      status: 500,
    });
  }
  const methods = new Set((options.methods ?? defaultMethods).map((m) => m.toUpperCase()));
  return Object.freeze({
    headerName,
    methods,
    ttlMs,
    requireKey: options.requireKey ?? false,
    maxKeys,
  });
}
