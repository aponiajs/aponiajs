export { IdempotencyModule } from "./idempotency.module.ts";
export { MemoryIdempotencyStore } from "./store/memory-idempotency.store.ts";
export { IDEMPOTENCY_OPTIONS, IDEMPOTENCY_STORE } from "./idempotency.constants.ts";
export {
  ASYNC_OPTIONS_TYPE,
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE,
  type IdempotencyModuleExtras,
  type IdempotencyModuleRegistrationAsyncOptions,
  type IdempotencyModuleSyncOptions,
} from "./idempotency.module-definition.ts";
export type {
  IdempotencyAcquireResult,
  IdempotencyModuleAsyncOptions,
  IdempotencyModuleOptions,
  IdempotencyRecord,
  IdempotencyStore,
  ResolvedIdempotencyOptions,
} from "./interfaces/idempotency-store.interface.ts";
