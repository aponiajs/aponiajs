import { Module, provideFactory, type DynamicModule } from "@aponiajs/common";
import { PluginModule, provideConfiguration } from "@aponiajs/platform-elysia";
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
 * Both spellings mount the same module, and neither is lowered into the
 * descriptor artifact `aponia build` writes: the build lowers an `imports` entry
 * only when it is a single identifier naming a declaration read from the
 * project's own source, and a registration returns a `DynamicModule` — a runtime
 * value rather than such a declaration — so the module that names one is
 * reported as `DECLINED` in every spelling. The scheduler still mounts and the
 * application still boots; what is given up is the declared-graph boot.
 *
 * One module carries three things, and they have to be one module rather than
 * three. The scheduler is a provider this registration builds, so it is one
 * per boot; the plugin is the `PluginModule` seam, which is the only way a
 * native plugin contributes to an application's route table; and the plugin has
 * to resolve the scheduler to be handed this boot's handles. A provider is
 * visible to a module that declares it or to one that imports it, so a split
 * would need the plugin module to import the scheduler module — and the
 * scheduler module does not exist as a class an application could name.
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
   */
  static register(options: CronModuleOptions): DynamicModule {
    const { configuration, source, key } = options;

    // The framework's own seam for a plugin built from an injected value. The
    // plugin is a `PluginModule` because that is what puts it in the module graph
    // and in the application's route table; it is built through the async form
    // because this boot's scheduler is what the plugin has to read.
    const pluginModule = PluginModule.registerAsync({
      key: key ?? defaultKey,
      inject: [CronScheduler],
      useFactory: (scheduler) => scheduler.createPlugin(),
    });

    return Object.freeze({
      ...pluginModule,
      imports: Object.freeze([]),
      // The scheduler injects the configuration, so the value is validated before
      // the scheduler exists: a configuration the schema refuses fails the boot in
      // the provider pass, naming the configuration and its issues, rather than
      // reaching the guard as a job list nobody wrote.
      providers: Object.freeze([
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideFactory(
          CronScheduler,
          [configuration],
          (value) => new CronScheduler(readCronJobs(value, configuration)),
        ),
        // Never empty in practice — the seam's own factory is always there — but
        // the type says a `DynamicModule` may declare no providers, and reading
        // it as one that always does is the assumption rather than the check.
        ...(pluginModule.providers ?? []),
      ]),
      // Both are exported so the application that mounted this module can read
      // them: the configuration, because the application declared it and reading
      // it back is cheaper than declaring it twice, and the scheduler, because
      // what a boot scheduled is otherwise knowable only from a log line.
      exports: Object.freeze([configuration, CronScheduler]),
    });
  }
}
