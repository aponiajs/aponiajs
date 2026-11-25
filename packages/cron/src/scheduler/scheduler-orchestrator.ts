import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@aponiajs/common";
import { Cron } from "croner";
import { SchedulerRegistry } from "./scheduler.registry.ts";
import { SCHEDULE_TIMER, schedulerError, type ScheduleTimer } from "./schedule-timer.ts";
import type { CronOptions, ScheduledCronOptions } from "../interfaces/schedule.interface.ts";

interface PendingCron {
  readonly name: string;
  readonly pattern: string | Date;
  readonly options: CronOptions;
  readonly target: () => unknown;
  initialDelay?: { readonly handle: unknown };
}

interface PendingInterval {
  readonly name: string;
  readonly timeout: number;
  readonly target: () => unknown;
}

interface PendingTimeout {
  readonly name: string;
  readonly timeout: number;
  readonly target: () => unknown;
}

/**
 * Mounts the decorators `@Cron`, `@Interval`, and `@Timeout` recorded.
 *
 * Mirrors `@nestjs/schedule`'s `SchedulerOrchestrator`: jobs are collected when
 * the explorer scans providers, mounted in `onApplicationBootstrap`, and
 * stopped in `beforeApplicationShutdown`. A failure in a scheduled method is
 * swallowed rather than escaping as an unhandled rejection; the engine and the
 * registry do the same on the official package.
 */
@Injectable()
export class SchedulerOrchestrator implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly #registry: SchedulerRegistry;
  readonly #timer: ScheduleTimer;
  readonly #cronJobs = new Map<string, PendingCron>();
  readonly #intervals = new Map<string, PendingInterval>();
  readonly #timeouts = new Map<string, PendingTimeout>();

  constructor(
    @Inject(SchedulerRegistry) registry: SchedulerRegistry,
    @Inject(SCHEDULE_TIMER) timer: ScheduleTimer,
  ) {
    this.#registry = registry;
    this.#timer = timer;
  }

  /** Collects one cron job; it starts at `onApplicationBootstrap`. */
  addCron(target: () => unknown, pattern: string | Date, options: CronOptions = {}): void {
    const name = options.name ?? randomUUID();
    if (this.#cronJobs.has(name)) {
      throw duplicate("cron", name);
    }
    this.#cronJobs.set(name, { name, pattern, options, target });
  }

  /** Collects one interval; it starts at `onApplicationBootstrap`. */
  addInterval(target: () => unknown, timeout: number, name: string = randomUUID()): void {
    if (this.#intervals.has(name)) {
      throw duplicate("interval", name);
    }
    this.#intervals.set(name, { name, timeout, target });
  }

  /** Collects one timeout; it starts at `onApplicationBootstrap`. */
  addTimeout(target: () => unknown, timeout: number, name: string = randomUUID()): void {
    if (this.#timeouts.has(name)) {
      throw duplicate("timeout", name);
    }
    this.#timeouts.set(name, { name, timeout, target });
  }

  /** Mounts every collected job. */
  onApplicationBootstrap(): void {
    this.#mountTimeouts();
    this.#mountIntervals();
    this.#mountCron();
  }

  /** Stops every mounted job. */
  beforeApplicationShutdown(): void {
    for (const pending of this.#cronJobs.values()) {
      if (pending.initialDelay !== undefined) {
        this.#timer.clearTimeout(pending.initialDelay.handle);
      }
    }
    this.#registry.clear();
    this.#cronJobs.clear();
    this.#intervals.clear();
    this.#timeouts.clear();
  }

  #mountTimeouts(): void {
    for (const pending of this.#timeouts.values()) {
      const handle = this.#timer.setTimeout(invoke(pending.target), pending.timeout);
      this.#registry.addTimeout(pending.name, handle);
    }
  }

  #mountIntervals(): void {
    for (const pending of this.#intervals.values()) {
      const handle = this.#timer.setInterval(invoke(pending.target), pending.timeout);
      this.#registry.addInterval(pending.name, handle);
    }
  }

  #mountCron(): void {
    for (const pending of this.#cronJobs.values()) {
      const options: ScheduledCronOptions = {
        timezone: pending.options.timezone,
        utcOffset: pending.options.utcOffset,
        maxRuns: pending.options.maxRuns,
        paused: pending.options.disabled === true,
      };
      const job = new Cron(pending.pattern, options, invoke(pending.target));
      this.#registry.addCronJob(pending.name, job);

      const initialDelay = pending.options.initialDelay;
      if (initialDelay !== undefined && initialDelay > 0 && pending.options.disabled !== true) {
        pending.initialDelay = {
          handle: this.#timer.setTimeout(() => {
            if (
              this.#registry.doesExist("cron", pending.name) &&
              this.#registry.getCronJob(pending.name) === job
            ) {
              job.resume();
            }
          }, initialDelay),
        };
      }
    }
  }
}

function duplicate(type: string, name: string): Error {
  return schedulerError("is already registered", type, name);
}

function invoke(target: () => unknown): () => void {
  return () => {
    try {
      const result = target();
      if (result instanceof Promise) {
        result.catch(() => {});
      }
    } catch {
      // The official package logs a scheduled method's failure and keeps the
      // scheduler alive; this package has no logger here, so it swallows it.
    }
  };
}
