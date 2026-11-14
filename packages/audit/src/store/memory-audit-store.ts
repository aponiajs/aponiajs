import { AponiaError } from "@aponiajs/common";
import type { AuditEvent, AuditStore } from "../module/audit.types.ts";
import type { MemoryAuditStoreOptions } from "./memory-audit-store.types.ts";

const defaultMaxEntries = 1_000;

/** A bounded, process-local audit store with oldest-insertion eviction. */
export class MemoryAuditStore implements AuditStore {
  readonly #events: AuditEvent[] = [];
  readonly #maxEntries: number;

  constructor(options: MemoryAuditStoreOptions = {}) {
    const maxEntries = options.maxEntries ?? defaultMaxEntries;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AponiaError(
        "INVALID_AUDIT_OPTIONS",
        `MemoryAuditStore maxEntries must be a positive integer, received ${String(maxEntries)}.`,
        { issues: Object.freeze(["maxEntries must be a positive integer"]) },
      );
    }
    this.#maxEntries = maxEntries;
  }

  record(event: AuditEvent): void {
    if (this.#events.length >= this.#maxEntries) {
      this.#events.shift();
    }
    this.#events.push(event);
  }

  list(limit = this.#events.length): readonly AuditEvent[] {
    return Object.freeze(this.#events.slice(Math.max(0, this.#events.length - limit)));
  }

  clear(): void {
    this.#events.length = 0;
  }

  /** The number of events retained. */
  get size(): number {
    return this.#events.length;
  }
}
