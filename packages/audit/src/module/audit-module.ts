import { AponiaError, Module, provideValue, type DynamicModule } from "@aponiajs/common";
import { AuditService } from "../service/audit-service.ts";
import { MemoryAuditStore } from "../store/memory-audit-store.ts";
import type { AuditModuleOptions, AuditStore } from "./audit.types.ts";

const defaultMaxEntries = 1_000;

/** Provides a bounded audit service and its store. */
@Module({})
export class AuditModule {
  /** Builds one audit registration. */
  static register(options: AuditModuleOptions = {}): DynamicModule {
    const maxEntries = options.maxEntries ?? defaultMaxEntries;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AponiaError(
        "INVALID_AUDIT_OPTIONS",
        "Audit maxEntries must be a positive integer.",
        { issues: Object.freeze(["maxEntries must be a positive integer"]) },
      );
    }
    const store: AuditStore = options.store ?? new MemoryAuditStore({ maxEntries });
    const service = new AuditService(store, options.redact);

    return Object.freeze({
      module: AuditModule,
      id: "AuditModule",
      instanceId: Symbol("AuditModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([provideValue(AuditService, service)]),
      exports: Object.freeze([AuditService]),
    });
  }
}
