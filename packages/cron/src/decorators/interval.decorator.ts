import { SCHEDULER_NAME, SCHEDULER_TYPE, SCHEDULE_INTERVAL_OPTIONS } from "../cron.constants.ts";
import { registerScheduledClass } from "../scheduler/scheduled-classes.ts";
import { SchedulerType } from "../cron.constants.ts";

/** Schedules a method with `setInterval`. */
export function Interval(timeout: number): MethodDecorator;
/** Schedules a named method with `setInterval`. */
export function Interval(name: string, timeout: number): MethodDecorator;
export function Interval(nameOrTimeout: string | number, timeout?: number): MethodDecorator {
  const [name, intervalTimeout] =
    typeof nameOrTimeout === "string" ? [nameOrTimeout, timeout] : [undefined, nameOrTimeout];
  if (intervalTimeout === undefined || !Number.isInteger(intervalTimeout) || intervalTimeout < 1) {
    throw new TypeError("Interval() requires a positive integer number of milliseconds.");
  }
  if (name !== undefined && name.trim() === "") {
    throw new TypeError("Interval() name must be a non-empty string when present.");
  }

  return ((target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    registerScheduledClass(target.constructor);
    Reflect.defineMetadata(
      SCHEDULE_INTERVAL_OPTIONS,
      Object.freeze({ timeout: intervalTimeout }),
      descriptor.value as object,
    );
    Reflect.defineMetadata(SCHEDULER_NAME, name, descriptor.value as object);
    Reflect.defineMetadata(SCHEDULER_TYPE, SchedulerType.INTERVAL, descriptor.value as object);
  }) as MethodDecorator;
}
