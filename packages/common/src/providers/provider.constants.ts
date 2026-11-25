/**
 * The lifetime a provider instance is kept for, with Nest's numeric values.
 *
 * `DEFAULT` is a singleton, `TRANSIENT` a fresh instance per injection, and
 * `REQUEST` one instance per request context. The legacy string spellings are
 * still accepted for one release; {@link normalizeProviderScope} lowers them
 * and warns once per spelling.
 */
export const Scope = {
  DEFAULT: 0,
  TRANSIENT: 1,
  REQUEST: 2,
} as const;

/**
 * The numeric lifetime values Nest's `Scope` enum declares.
 *
 * The name is exported as both a value and a type so an application can write
 * `scope: Scope.REQUEST` and `scope: Scope` exactly as it does with Nest.
 */
export type Scope = (typeof Scope)[keyof typeof Scope];

/**
 * A legacy scope spelling accepted for one release.
 *
 * @deprecated Use the numeric {@link Scope} values instead. A legacy spelling is
 * lowered on read and reported once.
 */
export type LegacyProviderScope = "singleton" | "request" | "transient";

/** What a provider declaration states as its lifetime. */
export type ProviderScope = Scope | LegacyProviderScope;

/** The lifetime the container and the platform actually run. */
export type NormalizedProviderScope = "singleton" | "request" | "transient";
