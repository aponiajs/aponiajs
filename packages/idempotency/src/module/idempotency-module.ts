import { AponiaError, Module, type DynamicModule } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { idempotencyPlugin } from "../runtime/idempotency-plugin.ts";
import { MemoryIdempotencyStore } from "../store/memory-idempotency-store.ts";
import type {
  IdempotencyModuleOptions,
  ResolvedIdempotencyOptions,
} from "./idempotency-module.types.ts";

const defaultTtlMs = 24 * 60 * 60 * 1_000;
const defaultHeader = "idempotency-key";
const defaultMethods = Object.freeze(["POST", "PATCH", "PUT"]);

/**
 * Mounts idempotent replay on the application's own route table.
 *
 * ```ts
 * @Module({ imports: [IdempotencyModule.register({ header: "idempotency-key" })] })
 * export class AppModule {}
 * ```
 */
@Module({})
export class IdempotencyModule {
  /** Builds one idempotency registration. */
  static register(options: IdempotencyModuleOptions = {}): DynamicModule {
    return PluginModule.register(idempotencyPlugin(resolveOptions(options)), {
      key: "idempotency",
    });
  }
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
  });
}
