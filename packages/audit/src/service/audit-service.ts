import { AponiaError } from "@aponiajs/common";
import type { AuditEvent, AuditEventInput, AuditStore } from "../module/audit.types.ts";

const sensitiveKeyPattern = /(secret|token|password|authorization|api[-_]?key|cookie)/i;

/** The audit service an application injects. */
export class AuditService {
  readonly #store: AuditStore;
  readonly #redact: ReadonlySet<string>;

  /** @internal Construct through `AuditModule.register`. */
  constructor(store: AuditStore, redact: readonly string[] = []) {
    this.#store = store;
    this.#redact = new Set(redact.map((key) => key.toLowerCase()));
  }

  /** Records one frozen audit event. */
  async record(input: AuditEventInput): Promise<AuditEvent> {
    if (typeof input.action !== "string" || input.action.trim() === "") {
      throw new AponiaError("INVALID_AUDIT_OPTIONS", "An audit action must be a non-empty string.");
    }
    const event = Object.freeze({
      action: input.action,
      outcome: input.outcome,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.tenant === undefined ? {} : { tenant: input.tenant }),
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      ...(input.metadata === undefined
        ? {}
        : { metadata: redactMetadata(input.metadata, this.#redact) }),
      timestamp: Date.now(),
    });
    await this.#store.record(event);
    return event;
  }

  /** Reads the most recent events, newest last. */
  async list(limit?: number): Promise<readonly AuditEvent[]> {
    return await this.#store.list(limit);
  }

  /** Clears the store. */
  async clear(): Promise<void> {
    await this.#store.clear();
  }
}

function redactMetadata(
  metadata: Readonly<Record<string, unknown>>,
  extra: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    copy[key] =
      sensitiveKeyPattern.test(key) || extra.has(key.toLowerCase()) ? "[redacted]" : value;
  }
  return Object.freeze(copy);
}
