import { AponiaError, type ConfigurationToken, type OnApplicationShutdown } from "@aponiajs/common";
import { Cron } from "croner";
import type { CronConfiguration, CronJob } from "../interfaces/cron-scheduler.interface.ts";

/**
 * The jobs one boot schedules, and the switch that ends them.
 *
 * A per-boot provider rather than a module-level value: a registration builds
 * one `DynamicModule` and a module class is declared once, so the applications
 * a process builds from it are several boots over one registration. The handles
 * a boot's jobs are reachable through are that boot's own, so stopping one
 * application's scheduler cannot reach into another's.
 *
 * The scheduler owns the handles rather than the engine's timer callbacks,
 * because a job starts whether or not anything was ever served: an object the
 * module graph can resolve is what makes `close()` able to stop it.
 *
 * @param jobs - The validated jobs this boot schedules, in declaration order.
 *
 * @example
 * ```ts
 * const scheduler = application.get(CronScheduler);
 * ```
 */
export class CronScheduler implements OnApplicationShutdown {
  readonly #jobs: readonly CronJob[];
  readonly #handles: Record<string, Cron> = Object.create(null);

  constructor(jobs: readonly CronJob[]) {
    this.#jobs = jobs;
  }

  /**
   * The jobs this scheduler was declared with, in declaration order.
   *
   * The declaration rather than the scheduled instances: a job is data this
   * package owns, and a caller has no other way to read back what a
   * configuration produced without reaching into the engine.
   */
  get jobs(): readonly CronJob[] {
    return this.#jobs;
  }

  /**
   * The names the engine has scheduled, in the order they arrived.
   *
   * Read from the handles rather than from the declaration, so this is what is
   * really scheduled.
   *
   * @returns The scheduled job names.
   */
  get scheduled(): readonly string[] {
    return Object.keys(this.#handles);
  }

  /**
   * Starts every declared job once. A second call starts nothing twice.
   *
   * @returns This scheduler, so a registration can start it in one expression.
   */
  start(): this {
    for (const job of this.#jobs) {
      if (job.name in this.#handles) {
        continue;
      }
      const context = Object.freeze({
        name: job.name,
        pattern: job.pattern,
        options: job.options ?? {},
      });
      this.#handles[job.name] = new Cron(job.pattern, { ...job.options }, () => job.run(context));
    }

    return this;
  }

  /**
   * Ends every job this boot scheduled, when the application closes.
   *
   * `onApplicationShutdown` rather than an earlier hook because stopping jobs
   * needs nothing that still has to be running, and running this last means
   * every other hook has already had its say. `stop()` rather than `pause()`:
   * an application that closed asked for the jobs to stop, not to resume. The
   * handles are dropped afterwards, so a second `close()` stops nothing twice.
   */
  onApplicationShutdown(): void {
    for (const handle of Object.values(this.#handles)) {
      handle.stop();
    }

    for (const name of Object.keys(this.#handles)) {
      delete this.#handles[name];
    }
  }
}

/**
 * The scheduler's jobs, read from the value a configuration validated into.
 *
 * A guard rather than a cast, because the value is data this package did not
 * write: a `defineConfiguration` transform is arbitrary JavaScript, and a
 * JavaScript caller can hand `provideConfiguration` a schema that answers
 * anything at all. What arrives therefore has to be checked before it reaches
 * the engine, which would otherwise throw its own bare `Error` halfway through
 * starting a boot.
 *
 * The refusal is this framework's: `INVALID_CONFIGURATION_VALUE`, with the
 * declaration's name and the same `issues` list a schema refusal carries. The
 * list is total: every entry that fails is reported rather than the first.
 *
 * @internal
 */
export function readCronJobs<TScheduledValue>(
  value: TScheduledValue,
  configuration: ConfigurationToken<CronConfiguration>,
): readonly CronJob[] {
  const name = configuration.description;
  const jobs = (value as { readonly jobs?: unknown } | null | undefined)?.jobs;

  if (!Array.isArray(jobs)) {
    throw invalidConfigurationValue(name, ['"jobs" must be an array of jobs']);
  }

  const issues = jobs.flatMap((job, index) => readJobIssues(job, index));

  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  return Object.freeze([...(jobs as readonly CronJob[])]);
}

function readJobIssues(job: unknown, index: number): string[] {
  const at = `jobs[${index}]`;

  if (typeof job !== "object" || job === null) {
    return [`${at} must be an object`];
  }

  const candidate = job as {
    readonly name?: unknown;
    readonly pattern?: unknown;
    readonly options?: unknown;
    readonly run?: unknown;
  };
  const issues: string[] = [];

  if (!isNonEmptyString(candidate.name)) {
    issues.push(`${at}.name must be a non-empty string`);
  }

  if (!isNonEmptyString(candidate.pattern)) {
    issues.push(
      `${at}.pattern must be a non-empty string: a cron expression, an ISO 8601 time, or a date`,
    );
  }

  if (typeof candidate.run !== "function") {
    issues.push(`${at}.run must be a function`);
  }

  if (
    candidate.options !== undefined &&
    (typeof candidate.options !== "object" || candidate.options === null)
  ) {
    issues.push(`${at}.options must be an object when it is present`);
  }

  return issues;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The refusal, in the shape a schema refusal already uses.
 *
 * The message names the declaration and states no count, because the two halves
 * of this guard refuse different things: a value that stated no job list has one
 * issue that is not a job, and a count of jobs would be a number about a list
 * that was not there.
 */
function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid cron configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
