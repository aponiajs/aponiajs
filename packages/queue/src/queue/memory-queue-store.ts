import { AponiaError } from "@aponiajs/common";
import type { QueueJob } from "./queue-job.types.ts";
import type { QueueStore } from "./queue-store.types.ts";

/** A bounded in-memory backlog, for tests and single-process durability checks. */
export class MemoryQueueStore implements QueueStore {
  readonly #jobs = new Map<string, QueueJob>();
  readonly #maxJobs: number;

  constructor(options: { readonly maxJobs?: number } = {}) {
    const maxJobs = options.maxJobs ?? 1_000;
    if (!Number.isInteger(maxJobs) || maxJobs < 1) {
      throw new AponiaError("INVALID_QUEUE_OPTIONS", "The queue store is invalid.", {
        issues: Object.freeze(["maxJobs must be a positive integer"]),
      });
    }
    this.#maxJobs = maxJobs;
  }

  load(): readonly QueueJob[] {
    return Object.freeze([...this.#jobs.values()]);
  }

  save(job: QueueJob): void {
    if (!this.#jobs.has(job.id) && this.#jobs.size >= this.#maxJobs) {
      const oldest = this.#jobs.keys().next().value;
      if (oldest !== undefined) {
        this.#jobs.delete(oldest);
      }
    }
    this.#jobs.set(job.id, job);
  }

  remove(id: string): void {
    this.#jobs.delete(id);
  }

  clear(): void {
    this.#jobs.clear();
  }
}
