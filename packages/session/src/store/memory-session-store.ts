import { AponiaError } from "@aponiajs/common";
import type { Session, SessionStore } from "../module/session.types.ts";
import type { MemorySessionStoreOptions } from "./memory-session-store.types.ts";

const defaultMaxSessions = 10_000;

/** A bounded, process-local session store with lazy expiry. */
export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #maxSessions: number;
  readonly #now: () => number;

  constructor(options: MemorySessionStoreOptions = {}) {
    const maxSessions = options.maxSessions ?? defaultMaxSessions;
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new AponiaError(
        "INVALID_SESSION_OPTIONS",
        `MemorySessionStore maxSessions must be a positive integer, received ${String(maxSessions)}.`,
        { issues: Object.freeze(["maxSessions must be a positive integer"]) },
      );
    }
    this.#maxSessions = maxSessions;
    this.#now = options.now ?? Date.now;
  }

  get(id: string): Session | undefined {
    const session = this.#sessions.get(id);
    if (session === undefined) {
      return undefined;
    }
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(id);
      return undefined;
    }
    return session;
  }

  set(session: Session): void {
    if (!this.#sessions.has(session.id) && this.#sessions.size >= this.#maxSessions) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest !== undefined) {
        this.#sessions.delete(oldest);
      }
    }
    this.#sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id);
  }

  clear(): void {
    this.#sessions.clear();
  }

  /** The number of sessions retained, including expired ones. */
  get size(): number {
    return this.#sessions.size;
  }
}
