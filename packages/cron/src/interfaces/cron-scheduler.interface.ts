import type { CronOptions } from "croner";

/**
 * The scheduler options one job forwards to the underlying engine.
 *
 * Derived from croner's own `CronOptions` rather than restated beside it, so a
 * croner release that widens, renames, or drops an option moves this type with
 * it and no copy inside this package can drift. `name` is the one member this
 * package owns: a job states it, and the scheduler hands it to the engine.
 */
export type CronJobOptions = Omit<CronOptions, "name">;

/**
 * What a job's `run` is called with: the job's own identity and the options the
 * scheduler handed the engine.
 *
 * The options are handed back so a `run` declared once reads the value its
 * configuration produced without closing over the whole configuration. They are
 * the declaration, not the copy the scheduler hands the engine: croner fills its
 * own defaults into the object it is given, and a job observing those would be
 * reading options it never declared.
 *
 * A job is called with this context rather than with the arguments the engine's
 * own timer callback receives, so a `run` declared once reads its own identity
 * and the options it wrote.
 */
export interface CronJobContext<TOptions extends CronJobOptions = CronJobOptions> {
  readonly name: string;
  readonly pattern: string;
  readonly options: TOptions;
}

/**
 * One scheduled job: its identity in the scheduler, the cron expression or ISO
 * 8601 time it fires on, the engine options it runs under, and what it does.
 *
 * A `name` and a `pattern` are both required and both must be non-empty
 * strings. The scheduler checks that before it mounts anything, so a job that
 * names neither is refused with this framework's error contract instead of
 * croner's bare `Error` thrown out of a state function halfway through a mount.
 *
 * `run` may be asynchronous. Its value is ignored: the engine is told only that
 * a tick happened, and a job's result has nowhere to go. A job that fails is
 * likewise the engine's business rather than this adapter's — there are no
 * retries, and `options.catch` is how a job asks the engine to survive a throw.
 */
export interface CronJob<TOptions extends CronJobOptions = CronJobOptions> {
  readonly name: string;
  readonly pattern: string;
  readonly options?: TOptions;
  /**
   * Written as a method declaration rather than as a property holding a function
   * type, and it is a rule rather than a style. A property is checked
   * contravariantly in its parameter under `strictFunctionTypes`, so the options
   * a job declares would be the *narrowest* type the configuration could ever
   * build: a job declared with `options: { timezone: "UTC" }` types its context
   * as that exact object, and a `CronJob` whose parameter is the wide
   * `CronJobContext<CronJobOptions>` is then not a `CronJob<{ timezone: string }>`
   * — so the most ordinary declaration there is, a configuration whose transform
   * names the three options it forwards, would fail to compile against
   * `CronConfiguration`. A method is checked bivariantly, which accepts it, and
   * this is the one place the parameter is the callee's: the scheduler calls the
   * job, so the job narrowing what it reads is a declaration rather than a
   * hazard.
   *
   * The return type is `unknown` on its own rather than a union with
   * `Promise<unknown>`. A union would say nothing a caller could act on — every
   * type is assignable to `unknown`, a promise included, so the second
   * constituent is absorbed and a sync `run` returning a value would be refused
   * by a narrower one. The wrapped plugin writes `any | Promise<any>`, which
   * collapses the same way; what makes a job's `run` usable asynchronously is
   * that `Promise<unknown>` is assignable to `unknown`, not that the union names
   * it.
   */
  run(context: CronJobContext<TOptions>): unknown;
}

/**
 * The value an application's configuration validates into: the jobs one
 * scheduler runs.
 *
 * The jobs themselves are not configuration data — a `run` is a function, and
 * no schema validates a function out of the environment. What a schema
 * validates is the parameters, and the transform that reads them is what builds
 * these jobs around them. A pattern an environment variable supplies therefore
 * reaches a job only after the schema has accepted it, which is what makes a
 * malformed value a refused boot rather than a `Cron` constructor throwing in a
 * state function.
 */
export interface CronConfiguration {
  readonly jobs: readonly CronJob[];
}
