import {
  AponiaError,
  Module,
  createToken,
  dynamicModule,
  moduleOptionsProviders,
  provideFactory,
  provideValue,
  type DynamicModule,
  type ModuleAsyncOptions,
  type ModuleImport,
  type OnApplicationShutdown,
  type Provider,
} from "@aponiajs/common";
import {
  provideHttpPolicyAsync,
  requirePlatformCapabilities,
  type HttpPolicy,
} from "@aponiajs/platform-core";
import { createIdempotencyPolicy } from "../runtime/idempotency.policy.ts";
import { MemoryIdempotencyStore } from "../store/memory-idempotency.store.ts";
import type {
  IdempotencyModuleOptions,
  ResolvedIdempotencyOptions,
} from "../interfaces/idempotency-module.interface.ts";

const defaultTtlMs = 24 * 60 * 60 * 1_000;
const defaultHeader = "idempotency-key";
const defaultMethods = Object.freeze(["POST", "PATCH", "PUT"]);
const moduleKey = "idempotency";

const IDEMPOTENCY_RESOLVED = createToken<ResolvedIdempotencyOptions>(
  "aponia.plugin.idempotency.resolved",
);
const IDEMPOTENCY_OWNER = createToken<{ readonly policy: HttpPolicy; close(): void }>(
  "aponia.plugin.idempotency.owner",
);

/** Releases this registration's outstanding claims when the application stops. */
class IdempotencyRuntime implements OnApplicationShutdown {
  readonly #owner: { close(): void };

  constructor(owner: { close(): void }) {
    this.#owner = owner;
  }

  onApplicationShutdown(): void {
    this.#owner.close();
  }
}

/**
 * Replays a mutating request against its idempotency key.
 *
 * ```ts
 * @Module({ imports: [IdempotencyModule.forRoot({ header: "idempotency-key" })] })
 * export class AppModule {}
 * ```
 *
 * The policy is a neutral `HttpPolicy`, so the same registration replays and
 * refuses identically on every platform.
 */
@Module({})
export class IdempotencyModule {
  /**
   * Builds one idempotency registration.
   *
   * @param options - TTL, entry cap, header, methods, store, and hooks.
   * @returns A frozen dynamic module an application imports.
   */
  static forRoot(options: IdempotencyModuleOptions = {}): DynamicModule {
    return registration([provideValue(IDEMPOTENCY_RESOLVED, resolveOptions(options))]);
  }

  /**
   * Builds an idempotency registration whose options a factory resolves.
   *
   * @param options - The imports, injected tokens, factory, and extra providers.
   * @returns The module registration an application imports.
   */
  static forRootAsync(options: ModuleAsyncOptions<IdempotencyModuleOptions>): DynamicModule {
    return registration(
      moduleOptionsProviders(IDEMPOTENCY_RESOLVED, options, resolveOptions),
      options.imports,
      options.extraProviders,
    );
  }

  /**
   * Builds one idempotency registration.
   *
   * @deprecated Use {@link IdempotencyModule.forRoot}; retained for the beta line.
   */
  static register(options: IdempotencyModuleOptions = {}): DynamicModule {
    return IdempotencyModule.forRoot(options);
  }
}

function registration(
  resolvedProviders: readonly Provider[],
  imports: readonly ModuleImport[] = [],
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return dynamicModule({
    module: IdempotencyModule,
    id: `IdempotencyModule[${moduleKey}]`,
    instanceId: Symbol.for(`aponia.idempotency:${moduleKey}`),
    imports,
    providers: [
      ...resolvedProviders,
      provideFactory(IDEMPOTENCY_OWNER, [IDEMPOTENCY_RESOLVED], (resolved) =>
        createIdempotencyPolicy(resolved),
      ),
      provideHttpPolicyAsync([IDEMPOTENCY_OWNER], (owner) => owner.policy),
      provideFactory(
        IdempotencyRuntime,
        [IDEMPOTENCY_OWNER],
        (owner) => new IdempotencyRuntime(owner),
      ),
      requirePlatformCapabilities("idempotency", ["http"]),
      ...extraProviders,
    ],
    exports: [],
  });
}

function resolveOptions(options: IdempotencyModuleOptions): ResolvedIdempotencyOptions {
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const maxEntries = options.maxEntries ?? 1_000;
  const header = options.header ?? defaultHeader;
  const requireKey = options.requireKey ?? false;
  const methods = options.methods ?? defaultMethods;
  const issues: string[] = [];

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    issues.push("ttlMs must be a positive number");
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    issues.push("maxEntries must be a positive integer");
  }
  if (typeof header !== "string" || header.trim() === "") {
    issues.push("header must be a non-empty string");
  }
  if (typeof requireKey !== "boolean") {
    issues.push("requireKey must be a boolean");
  }
  if (
    !Array.isArray(methods) ||
    methods.length === 0 ||
    methods.some((method) => typeof method !== "string" || method.trim() === "")
  ) {
    issues.push("methods must be a non-empty array of strings");
  }
  if (options.now !== undefined && typeof options.now !== "function") {
    issues.push("now must be a function");
  }
  if (options.onError !== undefined && typeof options.onError !== "function") {
    issues.push("onError must be a function");
  }
  if (options.scope !== undefined && typeof options.scope !== "function") {
    issues.push("scope must be a function");
  }
  const store = options.store ?? new MemoryIdempotencyStore({ maxEntries, now: options.now });
  if (typeof store !== "object" || store === null) {
    issues.push("store must implement IdempotencyStore");
  } else {
    const missing = ["get", "set", "delete", "clear"].filter(
      (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
    );
    if (missing.length > 0) {
      issues.push(`store is missing ${missing.join(", ")}`);
    }
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_IDEMPOTENCY_OPTIONS",
      "The idempotency registration is invalid.",
      {
        issues: Object.freeze([...issues]),
      },
    );
  }

  return Object.freeze({
    ttlMs,
    header,
    requireKey,
    methods: Object.freeze(methods.map((method) => method.toUpperCase())),
    store,
    onError: options.onError ?? (() => {}),
    scope: options.scope,
  });
}
