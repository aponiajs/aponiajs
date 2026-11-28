import type { CronOptions as CronerOptions } from "croner";

/**
 * The options `@Cron()` accepts.
 *
 * `name`, `disabled`, and `initialDelay` are this package's own scheduling
 * decisions; the rest are croner options forwarded to the engine.
 */
export interface CronOptions {
  /** The job name in `SchedulerRegistry`; `@nestjs/schedule` generates a UUID when omitted. */
  readonly name?: string;
  /** The timezone forwarded to croner. */
  readonly timezone?: string;
  /** The fixed UTC offset in minutes forwarded to croner. */
  readonly utcOffset?: number;
  /** The most runs the engine allows. */
  readonly maxRuns?: number;
  /** Creates the job paused, so it is registered but does not run. */
  readonly disabled?: boolean;
  /** Delays the first run by this many milliseconds after bootstrap. */
  readonly initialDelay?: number;
}

/** The interval options `@Interval()` records. */
export interface IntervalOptions {
  readonly timeout: number;
}

/** The timeout options `@Timeout()` records. */
export interface TimeoutOptions {
  readonly timeout: number;
}

/** The croner options a scheduled method forwards; never a restated copy. */
export type ScheduledCronOptions = Omit<CronerOptions, "name">;
