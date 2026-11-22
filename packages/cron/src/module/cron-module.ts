import { Module, provideFactory, type DynamicModule } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-core";
import { CronScheduler, readCronJobs } from "../scheduler/cron-scheduler.ts";
import type { CronModuleOptions } from "./cron-module.types.ts";

const defaultKey = "cron";

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
export class CronModule {
  /**
   * Builds the scheduler module for one application.
   *
   * ```ts
   * @Module({ imports: [CronModule.register({ configuration: CronConfig })] })
   * export class AppModule {}
   * ```
   *
   * @param options - The configuration, literal source, and module key.
   * @returns A frozen registration the application's `imports` accepts.
   */
  static register(options: CronModuleOptions): DynamicModule {
    const { configuration, source, key } = options;
    const moduleKey = key ?? defaultKey;

    return Object.freeze({
      module: CronModule,
      id: `CronModule[${moduleKey}]`,
      instanceId: Symbol.for(`aponia.cron:${moduleKey}`),
      imports: Object.freeze([]),
      // The scheduler injects the configuration, so the value is validated
      // before any job exists: a configuration the schema refuses fails the boot
      // in the provider pass, naming the configuration and its issues.
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideFactory(CronScheduler, [configuration], (value) =>
          new CronScheduler(readCronJobs(value, configuration)).start(),
        ),
      ]),
      // Both are exported so the application that mounted this module can read
      // them: the configuration, because the application declared it and reading
      // it back is cheaper than declaring it twice, and the scheduler, because
      // what a boot scheduled is otherwise knowable only from a log line.
      exports: Object.freeze([configuration, CronScheduler]),
    });
  }
}
