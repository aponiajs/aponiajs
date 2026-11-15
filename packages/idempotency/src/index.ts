/**
 * `@aponiajs/idempotency` — idempotent replay for mutating HTTP requests.
 *
 * The package owns the request plugin, the bounded default store, and the
 * replay contract. A repeat with the same key and request answers the recorded
 * status and body without reaching the handler; a key reused with a different
 * request is refused with `409`.
 */
export { IdempotencyModule } from "./module/idempotency-module.ts";
export { MemoryIdempotencyStore } from "./store/memory-idempotency-store.ts";
export type { IdempotencyModuleOptions } from "./module/idempotency-module.types.ts";
export type {
  IdempotencyStore,
  StoredIdempotentResponse,
} from "./store/idempotency-store.types.ts";
