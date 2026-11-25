import { SCHEDULER_NAME, SCHEDULER_TYPE, SCHEDULE_CRON_OPTIONS } from "../cron.constants.ts";
import { registerScheduledClass } from "../scheduler/scheduled-classes.ts";
import type { CronOptions } from "../interfaces/schedule.interface.ts";
import { SchedulerType } from "../cron.constants.ts";

/**
 * Schedules a method as a cron job.
 *
 * The expression and options are metadata only; `ScheduleExplorer` mounts the
 * job at `onApplicationBootstrap`.
 *
 * @param cronTime - A cron expression, an ISO 8601 time, or a date.
 * @param options - The job name and the engine options it forwards.
 * @returns The method decorator.
 * @throws A `TypeError` when the expression or name is empty.
 */
export function Cron(cronTime: string | Date, options: CronOptions = {}): MethodDecorator {
  if (typeof cronTime === "string" && cronTime.trim() === "") {
    throw new TypeError("Cron() requires a non-empty cron expression.");
  }
  if (!(cronTime instanceof Date) && typeof cronTime !== "string") {
    throw new TypeError("Cron() requires a cron expression or a date.");
  }
  if (
    options.name !== undefined &&
    (typeof options.name !== "string" || options.name.trim() === "")
  ) {
    throw new TypeError("Cron() name must be a non-empty string when present.");
  }
  if (
    options.initialDelay !== undefined &&
    (!Number.isInteger(options.initialDelay) || options.initialDelay < 0)
  ) {
    throw new TypeError("Cron() initialDelay must be a non-negative integer.");
  }

  return ((target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    registerScheduledClass(target.constructor);
    Reflect.defineMetadata(
      SCHEDULE_CRON_OPTIONS,
      Object.freeze({ ...options, cronTime }),
      descriptor.value as object,
    );
    Reflect.defineMetadata(SCHEDULER_NAME, options.name, descriptor.value as object);
    Reflect.defineMetadata(SCHEDULER_TYPE, SchedulerType.CRON, descriptor.value as object);
  }) as MethodDecorator;
}
