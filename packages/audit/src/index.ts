/**
 * `@aponiajs/audit` — bounded, redacting audit events.
 *
 * The package provides an injectable service, a small store contract, and a
 * bounded in-memory store. It records data; it does not mount a route or decide
 * who may read the audit stream.
 */
export { AuditModule } from "./module/audit-module.ts";
export { AuditService } from "./service/audit-service.ts";
export { MemoryAuditStore } from "./store/memory-audit-store.ts";
export type {
  AuditEvent,
  AuditEventInput,
  AuditModuleOptions,
  AuditOutcome,
  AuditStore,
} from "./module/audit.types.ts";
export type { MemoryAuditStoreOptions } from "./store/memory-audit-store.types.ts";
