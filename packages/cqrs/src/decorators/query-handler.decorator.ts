import type { ClassToken } from "@aponiajs/common";

const queryHandlerRegistry = new Map<ClassToken<unknown>, ClassToken<unknown>>();

/**
 * Marks a class as the handler for `query`.
 *
 * @param query - Query class handled by the decorated class.
 */
export function QueryHandler(query: ClassToken<unknown>): ClassDecorator {
  return (target) => {
    queryHandlerRegistry.set(target as unknown as ClassToken<unknown>, query);
  };
}

/** Returns all `@QueryHandler()` class-to-query registrations. */
export function getRegisteredQueryHandlers(): ReadonlyMap<
  ClassToken<unknown>,
  ClassToken<unknown>
> {
  return queryHandlerRegistry;
}
