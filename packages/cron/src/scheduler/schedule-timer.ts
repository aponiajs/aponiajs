import { AponiaError, createToken } from "@aponiajs/common";

/** The timer primitives the orchestrator uses, injectable for deterministic tests. */
export interface ScheduleTimer {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

/** The real timer, the default a boot uses. */
export const systemScheduleTimer: ScheduleTimer = Object.freeze({
  setTimeout: (handler: () => void, delayMs: number) =>
    globalThis.setTimeout(() => handler(), delayMs),
  clearTimeout: (handle: unknown) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (handler: () => void, delayMs: number) =>
    globalThis.setInterval(() => handler(), delayMs),
  clearInterval: (handle: unknown) =>
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
});

/** The token a test overrides with a deterministic timer. */
export const SCHEDULE_TIMER = createToken<ScheduleTimer>("SCHEDULE_TIMER");

/** A scheduler registry failure, carrying the kind and the name that failed. */
export function schedulerError(reason: string, schedulerType: string, name: string): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Scheduler "${name}" (${schedulerType}) ${reason}.`,
    Object.freeze({ schedulerType, name }),
  );
}
