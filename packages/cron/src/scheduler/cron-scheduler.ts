import { AponiaError, type ConfigurationToken, type OnApplicationShutdown } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { cron } from "@elysia/cron";
import { Elysia } from "elysia";
import type { CronConfiguration, CronJob } from "./cron-scheduler.types.ts";

/**
 * The state key `@elysia/cron` files a scheduled instance under, and the state
 * the adapter declares ahead of the plugin so the plugin writes into it.
 */
const cronStateKey = "cron";

const pluginName = "aponia.cron";

/**
 * What this adapter needs of one scheduled instance: the ability to end it.
 *
 * Structural rather than croner's `Cron`, and that is not abbreviation. croner
 * is `@elysia/cron`'s dependency rather than this package's — it is reachable
 * only transitively, and a Bun workspace resolves a transitive dependency only
 * from the package that declared it. Naming the class here would mean declaring
 * croner as a second dependency to describe a value only one method of which
 * this package ever reads, and the version it pins could then disagree with the
 * one the plugin actually constructs. `stop()` is the whole of the contract
 * this package uses, so it is the whole of the contract it states.
 */
interface CronHandle {
  stop(): void;
}

/**
 * The jobs one boot schedules, and the switch that ends them.
 *
 * A per-boot provider rather than a module-level value, and the distinction is
 * the whole reason this class exists. A registration builds one `DynamicModule`,
 * and one module class is declared once, so the applications a process builds
 * from it are several boots over one registration. The handles a boot's jobs
 * are reachable through are that boot's own — the container keys an instance per
 * module, and two boot containers hold two of these — so stopping one
 * application's scheduler cannot reach into another's.
 *
 * The scheduler is the owner of the handles rather than the plugin, because the
 * plugin's own lifetime is the application's: Elysia 2 offers no hook that runs
 * for an application that never listened, and a cron job starts whether or not
 * anything was ever served. An object the module graph can resolve is what makes
 * `close()` able to stop it, so the handles live here and the plugin is handed
 * this object's state slot to fill.
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
  /**
   * The state slot `@elysia/cron` writes into, created before the plugin is
   * mounted and never replaced.
   *
   * `@elysia/cron` reaches its instances through the store: its state function
   * reads `store.cron`, adds `cron[name] = new Cron(...)`, and answers the
   * merged store. Declaring this object under the same key before the plugin is
   * used is what makes those instances arrive here — the plugin reads the object
   * already in the store and mutates it, so a reference taken now is filled by
   * the mount. `Object.create(null)` rather than a literal, so a job named
   * `toString` or `constructor` is a job rather than a lookup that finds
   * something on `Object.prototype`.
   */
  readonly #handles: Record<string, CronHandle> = Object.create(null);

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
   * Read from the handles the plugin wrote rather than from the declaration, so
   * this is what is really scheduled: the two agree while the plugin is the only
   * writer, and a disagreement is the case worth being able to see.
   *
   * @returns The scheduled job names.
   */
  get scheduled(): readonly string[] {
    return Object.keys(this.#handles);
  }

  /**
   * Builds the native plugin for this scheduler, once, while the module mounts.
   *
   * One Elysia instance per boot, carrying the state slot above and one `cron`
   * plugin per job. It is built here rather than in the module because the
   * handles belong to one boot's scheduler, and the module's factory is the
   * framework's only seam for handing a per-boot value to a plugin.
   *
   * @returns The native plugin the module mounts.
   */
  createPlugin(): ElysiaPlugin {
    const plugin = new Elysia({ name: pluginName }).state({
      [cronStateKey]: this.#handles,
    });

    for (const job of this.#jobs) {
      plugin.use(cron(createJobConfig(job)));
    }

    return plugin;
  }

  /**
   * Ends every job this boot scheduled, when the application closes.
   *
   * `onApplicationShutdown` rather than `beforeApplicationShutdown` or
   * `onModuleDestroy` because stopping jobs needs nothing that still has to be
   * running: a job that ticks while the server is stopping is the job nobody
   * wants, and running this last also means every other hook this application
   * declared has already had its say. The hook runs under
   * `application.close()` whether or not the application ever listened, because
   * the plan a boot attaches is read from the container rather than from a
   * running server.
   *
   * `stop()` rather than `pause()`: croner's `stop()` cannot be resumed, which
   * is what an application that closed asked for. The handles are dropped
   * afterwards, so a second `close()` stops nothing a second time — the plan
   * runs this hook once per boot, and this makes the method safe on its own too.
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
 * Lowers one job into the config `@elysia/cron` accepts.
 *
 * The adapter's contribution is exactly one call frame: the job's `run` is
 * called with a context this package builds, once per tick, from values the
 * job itself declared. Nothing else about a job is translated — the pattern and
 * every option are forwarded untouched, which is what keeps this package an
 * adapter rather than a scheduler with opinions.
 */
function createJobConfig(job: CronJob): Parameters<typeof cron>[0] {
  const context = Object.freeze({
    name: job.name,
    pattern: job.pattern,
    options: job.options ?? {},
  });

  return {
    name: job.name,
    pattern: job.pattern,
    ...job.options,
    run: () => job.run(context),
  };
}

/**
 * The scheduler's jobs, read from the value a configuration validated into.
 *
 * A guard rather than a cast, because the value is data this package did not
 * write: a `defineConfiguration` transform is arbitrary JavaScript, and a
 * JavaScript caller can hand `provideConfiguration` a schema that answers
 * anything at all. What arrives therefore has to be checked before it reaches a
 * plugin that would otherwise fail with croner's own `Error` — or, worse,
 * mount nothing and report success.
 *
 * The refusal is this framework's: `INVALID_CONFIGURATION_VALUE`, with the
 * declaration's name and the same `issues` list a schema refusal carries, so a
 * caller reads one shape whichever half of the validation refused. The
 * `issues` list is what makes the failure actionable, and it is total: every
 * entry that fails is reported rather than the first, so one boot names every
 * job that has to be fixed.
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
 * that was not there. What a caller acts on is the `issues` list, which is the
 * same one `provideConfiguration` attaches when the schema is what refused.
 */
function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid cron configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
