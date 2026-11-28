import type { ClassToken } from "@aponiajs/common";

const eventsHandlerRegistry = new Map<ClassToken<unknown>, readonly ClassToken<unknown>[]>();

/**
 * Marks a class as a handler for one or more domain events.
 *
 * @param events - Event classes handled by the decorated class.
 */
export function EventsHandler(...events: readonly ClassToken<unknown>[]): ClassDecorator {
  return (target) => {
    eventsHandlerRegistry.set(target as unknown as ClassToken<unknown>, Object.freeze([...events]));
  };
}

/** Returns all `@EventsHandler()` class-to-events registrations. */
export function getRegisteredEventsHandlers(): ReadonlyMap<
  ClassToken<unknown>,
  readonly ClassToken<unknown>[]
> {
  return eventsHandlerRegistry;
}
