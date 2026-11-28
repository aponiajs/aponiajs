import type { ClassToken } from "@aponiajs/common";

const sagaRegistry = new Map<ClassToken<unknown>, Set<string | symbol>>();

/**
 * Marks a provider method as a CQRS `@Saga()`.
 */
export function Saga(): PropertyDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor as ClassToken<unknown>;
    let keys = sagaRegistry.get(ctor);
    if (keys === undefined) {
      keys = new Set();
      sagaRegistry.set(ctor, keys);
    }
    keys.add(propertyKey);
  };
}

/** Returns all `@Saga()` class-to-propertyKey registrations. */
export function getRegisteredSagas(): ReadonlyMap<
  ClassToken<unknown>,
  ReadonlySet<string | symbol>
> {
  return sagaRegistry;
}
