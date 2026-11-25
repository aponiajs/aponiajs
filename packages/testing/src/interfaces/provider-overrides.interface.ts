import type { Provider, Token } from "@aponiajs/common";

/**
 * The providers one test replaces, keyed by the token they replace.
 *
 * A map rather than a list because a token is the identity an override is
 * stated against: declaring the same token twice is one decision, and the
 * later entry winning is the whole of the rule.
 */
export type ProviderOverrides = ReadonlyMap<Token<unknown>, Provider>;
