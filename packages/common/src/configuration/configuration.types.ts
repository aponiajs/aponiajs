import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { InjectionToken } from "../tokens/token.types.ts";

/**
 * An injection token that carries the schema its value must satisfy.
 *
 * The schema cannot be a token by itself: `Token<T>` is a class or an
 * `InjectionToken`, and a validation schema is neither, so it has no identity
 * the graph's lookup could key on. This wrapper is not decoration — it is what
 * makes the schema addressable, and it is why one value is both the thing a
 * service injects and the declaration of what that thing is.
 */
export interface ConfigurationToken<T> extends InjectionToken<T> {
  readonly schema: StandardSchemaV1<unknown, T>;
}

/** How a loader is asked to validate something other than the process environment. */
export interface ConfigurationOptions {
  /**
   * The record the schema validates. Defaults to the process environment.
   * Present so a test can validate a literal without touching `process.env`.
   */
  readonly source?: Readonly<Record<string, unknown>>;
}
