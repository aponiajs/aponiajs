import {
  AponiaError,
  Module,
  ModuleRef,
  provideClass,
  provideFactory,
  provideValue,
  type ConfigurableModuleAsyncOptions,
  type DynamicModule,
} from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/common";
import { CronScheduler, readCronJobs } from "./scheduler/cron-scheduler.ts";
import { ScheduleExplorer } from "./scheduler/schedule.explorer.ts";
import { SCHEDULE_TIMER, systemScheduleTimer } from "./scheduler/schedule-timer.ts";
import { SchedulerOrchestrator } from "./scheduler/scheduler-orchestrator.ts";
import { SchedulerRegistry } from "./scheduler/scheduler.registry.ts";
import type { CronModuleOptions } from "./interfaces/cron-module.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type CronModuleExtras,
  type CronModuleSyncOptions,
} from "./cron.module-definition.ts";

/**
 * The module an application imports to run scheduled jobs.
 *
 * ```ts
 * const scheduler = CronModule.register({ configuration: CronConfig });
 *
 * @Module({ imports: [scheduler] })
 * export class AppModule {}
 * ```
 *
 * The registration is runtime-neutral: the scheduler is a provider this module
 * owns, it reads the validated configuration, and it starts the engine from the
 * provider factory, so the module runs wherever the container does.
 *
 * Neither spelling is lowered into the descriptor artifact `aponia build`
 * writes: the build lowers an `imports` entry only when it is a single
 * identifier naming a declaration read from the project's own source, and a
 * registration returns a `DynamicModule` — a runtime value rather than such a
 * declaration — so the module that names one is reported as `DECLINED` in every
 * spelling. The scheduler still mounts and the application still boots; what is
 * given up is the declared-graph boot.
 */
@Module({})
export class CronModule extends ConfigurableModuleClass {
  /**
   * Builds the scheduler module for one application.
   *
   * ```ts
   * @Module({ imports: [CronModule.register({ configuration: CronConfig })] })
   * export class AppModule {}
   * ```
   *
   * @param options - The configuration, literal source, module key, and extras.
   * @returns A frozen registration the application's `imports` accepts.
   * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE` when the registration is malformed.
   */
  static forRoot(options: CronModuleSyncOptions): DynamicModule {
    const { configuration, source, key } = assertOptions(options);
    const definition = super.register(options);
    return Object.freeze({
      ...definition,
      module: CronModule,
      imports: Object.freeze([...(definition.imports ?? [])]),
      // The scheduler injects the configuration, so the value is validated
      // before any job exists: a configuration the schema refuses fails the boot
      // in the provider pass, naming the configuration and its issues.
      providers: Object.freeze([
        ...(definition.providers ?? []),
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideFactory(CronScheduler, [configuration], (value) =>
          new CronScheduler(readCronJobs(value, configuration)).start(),
        ),
        provideValue(SCHEDULE_TIMER, systemScheduleTimer),
        provideClass(SchedulerRegistry, [SCHEDULE_TIMER]),
        provideClass(SchedulerOrchestrator, [SchedulerRegistry, SCHEDULE_TIMER]),
        provideClass(ScheduleExplorer, [MODULE_OPTIONS_TOKEN, SchedulerOrchestrator, ModuleRef]),
      ]),
      // Both are exported so the application that mounted this module can read
      // them: the configuration, because the application declared it and reading
      // it back is cheaper than declaring it twice, and the scheduler, because
      // what a boot scheduled is otherwise knowable only from a log line.
      exports: Object.freeze([
        MODULE_OPTIONS_TOKEN,
        configuration,
        CronScheduler,
        SchedulerRegistry,
      ]),
      id: `CronModule[${key}]`,
      instanceId: Symbol.for(`aponia.cron:${key}`),
    });
  }

  /**
   * Builds the scheduler module for one application.
   *
   * @deprecated Use {@link CronModule.forRoot}; retained for the beta line.
   */
  static override register(options: CronModuleSyncOptions): DynamicModule {
    return CronModule.forRoot(options);
  }

  /**
   * Refuses the asynchronous form, which this package's registration cannot serve.
   *
   * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE`; the module
   * provides the configuration token it schedules, and a factory result cannot
   * name that token before the registration is built.
   */
  static override registerAsync(
    _options: ConfigurableModuleAsyncOptions<CronModuleOptions> & Partial<CronModuleExtras>,
  ): DynamicModule {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      "CronModule does not support an asynchronous registration: state the configuration token in forRoot.",
      { configuration: "cron", issues: Object.freeze(["registerAsync is not supported"]) },
    );
  }
}

function assertOptions(options: CronModuleOptions): {
  readonly configuration: CronModuleOptions["configuration"];
  readonly source: CronModuleOptions["source"];
  readonly key: string;
} {
  const issues: string[] = [];
  const configuration = options?.configuration;
  const source = options?.source;
  const key = options?.key ?? "cron";

  if (
    typeof configuration !== "object" ||
    configuration === null ||
    typeof (configuration as { readonly id?: unknown }).id !== "symbol"
  ) {
    issues.push("configuration must be a defineConfiguration token");
  }
  if (source !== undefined && (typeof source !== "object" || source === null)) {
    issues.push("source must be an object when present");
  }
  if (typeof key !== "string" || key.trim() === "") {
    issues.push("key must be a non-empty string");
  }
  for (const flag of ["cronJobs", "intervals", "timeouts"] as const) {
    const value = options?.[flag];
    if (value !== undefined && typeof value !== "boolean") {
      issues.push(`${flag} must be a boolean`);
    }
  }
  if (
    options !== null &&
    typeof options === "object" &&
    (options as { readonly isGlobal?: unknown }).isGlobal !== undefined &&
    typeof (options as { readonly isGlobal?: unknown }).isGlobal !== "boolean"
  ) {
    issues.push("isGlobal must be a boolean");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      `The cron registration is invalid: ${issues.join("; ")}.`,
      { configuration: "cron", issues: Object.freeze(issues) },
    );
  }

  return { configuration, source, key };
}
