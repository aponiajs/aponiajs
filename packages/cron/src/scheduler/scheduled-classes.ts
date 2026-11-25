import type { ClassToken } from "@aponiajs/common";

const scheduledClasses = new Set<ClassToken<unknown>>();

/** @internal Records one class a schedule decorator appeared on. */
export function registerScheduledClass(target: object): void {
  scheduledClasses.add(target as ClassToken<unknown>);
}

/** @internal The classes a schedule decorator appeared on, in declaration order. */
export function getScheduledClasses(): readonly ClassToken<unknown>[] {
  return Object.freeze([...scheduledClasses]);
}
