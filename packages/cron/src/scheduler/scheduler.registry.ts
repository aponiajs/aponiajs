import { Injectable } from "@aponiajs/common";
import type { Cron } from "croner";
import { schedulerError, systemScheduleTimer, type ScheduleTimer } from "./schedule-timer.ts";

/**
 * The handles one boot scheduled, keyed by name.
 *
 * Mirrors `@nestjs/schedule`'s `SchedulerRegistry`: a caller reads a cron job,
 * an interval, or a timeout back by name, and deletes it through the registry.
 * The handles are this boot's own, so two applications built from one module do
 * not share them.
 */
@Injectable()
export class SchedulerRegistry {
  readonly #cronJobs = new Map<string, Cron>();
  readonly #timeouts = new Map<string, unknown>();
  readonly #intervals = new Map<string, unknown>();
  readonly #timer: ScheduleTimer;

  constructor(timer: ScheduleTimer = systemScheduleTimer) {
    this.#timer = timer;
  }

  /** Whether a job of the given kind is registered under the name. */
  doesExist(type: "cron" | "timeout" | "interval", name: string): boolean {
    switch (type) {
      case "cron":
        return this.#cronJobs.has(name);
      case "interval":
        return this.#intervals.has(name);
      case "timeout":
        return this.#timeouts.has(name);
    }
  }

  /** One registered cron job. */
  getCronJob(name: string): Cron {
    const ref = this.#cronJobs.get(name);
    if (ref === undefined) {
      throw schedulerError("is not registered", "cron", name);
    }
    return ref;
  }

  /** One registered interval handle. */
  getInterval<T = unknown>(name: string): T {
    if (!this.#intervals.has(name)) {
      throw schedulerError("is not registered", "interval", name);
    }
    return this.#intervals.get(name) as T;
  }

  /** One registered timeout handle. */
  getTimeout<T = unknown>(name: string): T {
    if (!this.#timeouts.has(name)) {
      throw schedulerError("is not registered", "timeout", name);
    }
    return this.#timeouts.get(name) as T;
  }

  /** Adds one cron job, refusing a duplicate name. */
  addCronJob(name: string, job: Cron): void {
    if (this.#cronJobs.has(name)) {
      throw schedulerError("is already registered", "cron", name);
    }
    this.#cronJobs.set(name, job);
  }

  /** Adds one interval handle, refusing a duplicate name. */
  addInterval<T = unknown>(name: string, intervalId: T): void {
    if (this.#intervals.has(name)) {
      throw schedulerError("is already registered", "interval", name);
    }
    this.#intervals.set(name, intervalId);
  }

  /** Adds one timeout handle, refusing a duplicate name. */
  addTimeout<T = unknown>(name: string, timeoutId: T): void {
    if (this.#timeouts.has(name)) {
      throw schedulerError("is already registered", "timeout", name);
    }
    this.#timeouts.set(name, timeoutId);
  }

  /** The registered cron jobs, as a read-only map. */
  getCronJobs(): ReadonlyMap<string, Cron> {
    return new Map(this.#cronJobs);
  }

  /** Stops and removes one cron job. */
  deleteCronJob(name: string): void {
    const job = this.getCronJob(name);
    job.stop();
    this.#cronJobs.delete(name);
  }

  /** The registered interval names. */
  getIntervals(): readonly string[] {
    return Object.freeze([...this.#intervals.keys()]);
  }

  /** Clears and removes one interval. */
  deleteInterval(name: string): void {
    const interval = this.getInterval(name);
    this.#timer.clearInterval(interval);
    this.#intervals.delete(name);
  }

  /** The registered timeout names. */
  getTimeouts(): readonly string[] {
    return Object.freeze([...this.#timeouts.keys()]);
  }

  /** Clears and removes one timeout. */
  deleteTimeout(name: string): void {
    const timeout = this.getTimeout(name);
    this.#timer.clearTimeout(timeout);
    this.#timeouts.delete(name);
  }

  /** @internal Stops every handle this boot owns. */
  clear(): void {
    for (const job of this.#cronJobs.values()) {
      job.stop();
    }
    for (const name of this.getIntervals()) {
      this.deleteInterval(name);
    }
    for (const name of this.getTimeouts()) {
      this.deleteTimeout(name);
    }
    this.#cronJobs.clear();
  }
}
