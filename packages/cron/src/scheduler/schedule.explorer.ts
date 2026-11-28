import { Inject, Injectable, ModuleRef, type OnModuleInit } from "@aponiajs/common";
import {
  SCHEDULER_NAME,
  SCHEDULER_TYPE,
  SCHEDULE_CRON_OPTIONS,
  SCHEDULE_INTERVAL_OPTIONS,
  SCHEDULE_TIMEOUT_OPTIONS,
} from "../cron.constants.ts";
import type { CronModuleOptions } from "../interfaces/cron-module.interface.ts";
import { MODULE_OPTIONS_TOKEN } from "../cron.module-definition.ts";
import { getScheduledClasses } from "./scheduled-classes.ts";
import { SchedulerOrchestrator } from "./scheduler-orchestrator.ts";
import { SchedulerType } from "../cron.constants.ts";
import type { CronOptions } from "../interfaces/schedule.interface.ts";

interface CronMetadata extends CronOptions {
  readonly cronTime: string | Date;
}

interface TimeoutMetadata {
  readonly timeout: number;
}

/**
 * Scans the providers `@Cron`, `@Interval`, and `@Timeout` marked and collects
 * their jobs on the orchestrator.
 *
 * Mirrors `@nestjs/schedule`'s `ScheduleExplorer`: the module options gate each
 * kind, and a class that is not a provider in this boot is skipped rather than
 * constructed twice.
 */
@Injectable()
export class ScheduleExplorer implements OnModuleInit {
  readonly #options: CronModuleOptions;
  readonly #orchestrator: SchedulerOrchestrator;
  readonly #moduleRef: ModuleRef;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) options: CronModuleOptions,
    @Inject(SchedulerOrchestrator) orchestrator: SchedulerOrchestrator,
    @Inject(ModuleRef) moduleRef: ModuleRef,
  ) {
    this.#options = options;
    this.#orchestrator = orchestrator;
    this.#moduleRef = moduleRef;
  }

  onModuleInit(): void {
    for (const scheduledClass of getScheduledClasses()) {
      let instance: object;
      try {
        instance = this.#moduleRef.get(scheduledClass, { strict: false }) as object;
      } catch {
        continue;
      }

      for (const methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== "function") {
          continue;
        }
        this.#collect(instance, method as (...arguments_: unknown[]) => unknown);
      }
    }
  }

  #collect(instance: object, method: (...arguments_: unknown[]) => unknown): void {
    const type = Reflect.getMetadata(SCHEDULER_TYPE, method) as SchedulerType | undefined;
    const name = Reflect.getMetadata(SCHEDULER_NAME, method) as string | undefined;
    const target = (): unknown => method.call(instance);

    switch (type) {
      case SchedulerType.CRON: {
        if (this.#options.cronJobs === false) {
          return;
        }
        const metadata = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method) as
          | CronMetadata
          | undefined;
        if (metadata === undefined) {
          return;
        }
        const { cronTime, ...options } = metadata;
        this.#orchestrator.addCron(target, cronTime, {
          ...options,
          ...(name === undefined ? {} : { name }),
        });
        return;
      }
      case SchedulerType.TIMEOUT: {
        if (this.#options.timeouts === false) {
          return;
        }
        const metadata = Reflect.getMetadata(SCHEDULE_TIMEOUT_OPTIONS, method) as
          | TimeoutMetadata
          | undefined;
        if (metadata === undefined) {
          return;
        }
        this.#orchestrator.addTimeout(target, metadata.timeout, name);
        return;
      }
      case SchedulerType.INTERVAL: {
        if (this.#options.intervals === false) {
          return;
        }
        const metadata = Reflect.getMetadata(SCHEDULE_INTERVAL_OPTIONS, method) as
          | TimeoutMetadata
          | undefined;
        if (metadata === undefined) {
          return;
        }
        this.#orchestrator.addInterval(target, metadata.timeout, name);
        return;
      }
      case undefined:
        return;
      default:
        return;
    }
  }
}
