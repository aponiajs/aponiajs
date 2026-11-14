/**
 * `@aponiajs/cron` — declare scheduled jobs in an Aponia module.
 *
 * The package wraps `@elysia/cron`, which wraps `croner`. It adds no scheduling
 * engine: it contributes a module a declaration belongs in, and a validated
 * configuration the jobs are read from. An application that wants the raw plugin
 * should install `@elysia/cron` directly.
 */
export { CronModule } from "./module/cron-module.ts";
export { CronScheduler } from "./scheduler/cron-scheduler.ts";
export type { CronModuleOptions } from "./module/cron-module.types.ts";
export type {
  CronConfiguration,
  CronJob,
  CronJobContext,
  CronJobOptions,
} from "./scheduler/cron-scheduler.types.ts";
