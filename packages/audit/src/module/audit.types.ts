/** The outcome one audited operation carries. */
export type AuditOutcome = "success" | "failure" | "denied";

/** One recorded audit event. */
export interface AuditEvent {
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly actor?: string | number;
  readonly tenant?: string;
  readonly resource?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

/** The value a caller passes to `AuditService.record`. */
export interface AuditEventInput {
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly actor?: string | number;
  readonly tenant?: string;
  readonly resource?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The storage contract an audit registration accepts. */
export interface AuditStore {
  record(event: AuditEvent): void | Promise<void>;
  list(limit?: number): readonly AuditEvent[] | Promise<readonly AuditEvent[]>;
  clear(): void | Promise<void>;
}

/** Options an audit registration accepts. */
export interface AuditModuleOptions {
  readonly store?: AuditStore;
  readonly maxEntries?: number;
  readonly redact?: readonly string[];
}
