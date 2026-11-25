/**
 * `@aponiajs/audit` — bounded, redacting audit events.
 *
 * The package provides an injectable service, a small store contract, and a
 * bounded in-memory store. It records data; it does not mount a route or decide
 * who may read the audit stream.
 */
export { AuditModule } from "./module/audit.module.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type AuditModuleExtras,
  type AuditModuleRegistrationAsyncOptions,
  type AuditModuleSyncOptions,
} from "./module/audit.module-definition.ts";
export { AuditService } from "./service/audit.service.ts";
export { MemoryAuditStore } from "./store/memory-audit.store.ts";
export type {
  AuditEvent,
  AuditEventInput,
  AuditModuleAsyncOptions,
  AuditModuleOptions,
  AuditOutcome,
  AuditStore,
} from "./interfaces/audit.interface.ts";
export type { MemoryAuditStoreOptions } from "./interfaces/memory-audit-store.interface.ts";
