/** Constructor signature for a DTO or validation-model class. */
export type ClassConstructor<T = object> = new (...args: never[]) => T;

/** Derived constructor type produced by mapped-type helpers. */
export type MappedType<T> = (new (...args: never[]) => T) & {
  readonly schema?: unknown;
};
