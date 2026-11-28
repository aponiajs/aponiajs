import { SCHEDULER_NAME, SCHEDULER_TYPE, SCHEDULE_TIMEOUT_OPTIONS } from "../cron.constants.ts";
import { registerScheduledClass } from "../scheduler/scheduled-classes.ts";
import { SchedulerType } from "../cron.constants.ts";

/** Schedules a method with `setTimeout`. */
export function Timeout(timeout: number): MethodDecorator;
/** Schedules a named method with `setTimeout`. */
export function Timeout(name: string, timeout: number): MethodDecorator;
export function Timeout(nameOrTimeout: string | number, timeout?: number): MethodDecorator {
  const [name, timeoutValue] =
    typeof nameOrTimeout === "string" ? [nameOrTimeout, timeout] : [undefined, nameOrTimeout];
  if (timeoutValue === undefined || !Number.isInteger(timeoutValue) || timeoutValue < 1) {
    throw new TypeError("Timeout() requires a positive integer number of milliseconds.");
  }
  if (name !== undefined && name.trim() === "") {
    throw new TypeError("Timeout() name must be a non-empty string when present.");
  }

  return ((target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    registerScheduledClass(target.constructor);
    Reflect.defineMetadata(
      SCHEDULE_TIMEOUT_OPTIONS,
      Object.freeze({ timeout: timeoutValue }),
      descriptor.value as object,
    );
    Reflect.defineMetadata(SCHEDULER_NAME, name, descriptor.value as object);
    Reflect.defineMetadata(SCHEDULER_TYPE, SchedulerType.TIMEOUT, descriptor.value as object);
  }) as MethodDecorator;
}
