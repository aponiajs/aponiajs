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
  return deepFreezeRedact(metadata, extra, new WeakSet(), 0) as Readonly<Record<string, unknown>>;
}

/**
 * Copies, redacts, and freezes a metadata tree.
 *
 * Nested objects are the common leak: a top-level-only scan leaves
 * `{ user: { password } }` untouched and shares the caller's object, so a later
 * mutation rewrites history. The copy is bounded in depth and breaks cycles
 * with a marker rather than throwing.
 */
function deepFreezeRedact(
  value: unknown,
  extra: ReadonlySet<string>,
  ancestors: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > 8) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return "[circular]";
    }
    ancestors.add(value);
    const copy = value.map((entry) => deepFreezeRedact(entry, extra, ancestors, depth + 1));
    ancestors.delete(value);
    return Object.freeze(copy);
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) {
      return "[circular]";
    }
    ancestors.add(value);
    // `Object.fromEntries` defines own data properties, so a caller key named
    // `__proto__` stays an ordinary frozen entry instead of replacing the
    // copy's prototype with caller-controlled values.
    const entries: [string, unknown][] = [];
    for (const [key, entry] of Object.entries(value)) {
      entries.push([
        key,
        sensitiveKeyPattern.test(key) || extra.has(key.toLowerCase())
          ? "[redacted]"
          : deepFreezeRedact(entry, extra, ancestors, depth + 1),
      ]);
    }
    ancestors.delete(value);
    return Object.freeze(Object.fromEntries(entries));
  }
  return value;
}
