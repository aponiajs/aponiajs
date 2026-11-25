/** The metadata key recording a scheduled method's name. */
export const SCHEDULER_NAME = "SCHEDULER_NAME";
/** The metadata key recording a scheduled method's kind. */
export const SCHEDULER_TYPE = "SCHEDULER_TYPE";
/** The metadata key recording a `@Cron()` expression and options. */
export const SCHEDULE_CRON_OPTIONS = "SCHEDULE_CRON_OPTIONS";
/** The metadata key recording an `@Interval()` timeout. */
export const SCHEDULE_INTERVAL_OPTIONS = "SCHEDULE_INTERVAL_OPTIONS";
/** The metadata key recording a `@Timeout()` timeout. */
export const SCHEDULE_TIMEOUT_OPTIONS = "SCHEDULE_TIMEOUT_OPTIONS";
/** The token name `@nestjs/schedule` publishes for the module options. */
export const SCHEDULE_MODULE_OPTIONS = "SCHEDULE_MODULE_OPTIONS";

/** The three scheduler kinds `@nestjs/schedule` publishes. */
export enum SchedulerType {
  CRON = "cron",
  TIMEOUT = "timeout",
  INTERVAL = "interval",
}
