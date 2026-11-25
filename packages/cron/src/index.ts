/**
 * `@aponiajs/cron` — declare scheduled jobs in an Aponia module.
 *
 * The package owns [croner](https://github.com/hexagon/croner) as its engine. It
 * contributes a module a declaration belongs in, a validated configuration the
 * jobs are read from, and the `@Cron`/`@Interval`/`@Timeout` surface with the
 * `SchedulerRegistry` `@nestjs/schedule` publishes.
 */
export { CronModule } from "./cron.module.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type CronModuleExtras,
  type CronModuleRegistrationAsyncOptions,
  type CronModuleSyncOptions,
} from "./cron.module-definition.ts";
export { Cron } from "./decorators/cron.decorator.ts";
export { Interval } from "./decorators/interval.decorator.ts";
export { Timeout } from "./decorators/timeout.decorator.ts";
export { SchedulerRegistry } from "./scheduler/scheduler.registry.ts";
export { SchedulerOrchestrator } from "./scheduler/scheduler-orchestrator.ts";
export { ScheduleExplorer } from "./scheduler/schedule.explorer.ts";
export {
  SCHEDULE_TIMER,
  systemScheduleTimer,
  type ScheduleTimer,
} from "./scheduler/schedule-timer.ts";
export { SchedulerType } from "./cron.constants.ts";
export type {
  CronOptions,
  IntervalOptions,
  TimeoutOptions,
} from "./interfaces/schedule.interface.ts";
export { CronScheduler } from "./scheduler/cron-scheduler.ts";
export type { CronModuleOptions } from "./interfaces/cron-module.interface.ts";
export type {
  CronConfiguration,
  CronJob,
  CronJobContext,
  CronJobOptions,
} from "./interfaces/cron-scheduler.interface.ts";
