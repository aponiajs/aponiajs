import type { ConfigurationToken } from "@aponiajs/common";
import type { CronConfiguration } from "../scheduler/cron-scheduler.types.ts";

/**
 * How an application declares the scheduler in its `imports`.
 *
 * The jobs arrive through `configuration` rather than as an options object, and
 * that is the contract this package exists to add: a validated configuration
 * turns a malformed pattern or a missing parameter into a refused boot with a
 * code and an issue list, where a loose object literal reaches the engine and
 * fails there — or, for a pattern the engine happens to tolerate, does not fail
 * at all.
 */
export interface CronModuleOptions {
  /**
   * The declaration whose value states the jobs.
   *
   * The module provides this token itself, from the environment unless `source`
   * says otherwise, and exports it, so the same validated value is both what the
   * scheduler schedules and what the application can inject. It is a
   * `defineConfiguration` result rather than a schema, because the token is what
   * the container keys the value by and the schema alone has no identity a graph
   * could resolve.
   */
  readonly configuration: ConfigurationToken<CronConfiguration>;
  /**
   * The record the configuration's schema validates, instead of `process.env`.
   *
   * Present for the same reason `provideConfiguration` accepts it: a literal is
   * how a test — or an application reading a file rather than its environment —
   * validates without mutating the process. Omitting it reads the environment,
   * which is what an application in production wants and what a test must not
   * get.
   */
  readonly source?: Readonly<Record<string, unknown>>;
  /**
   * The module's stable identity, so one application may run more than one
   * scheduler.
   *
   * Two registrations under one key are one module identity, which the graph
   * refuses as a duplicate rather than silently scheduling one set of jobs
   * twice. Defaults to `"cron"`.
   */
  readonly key?: string;
}
