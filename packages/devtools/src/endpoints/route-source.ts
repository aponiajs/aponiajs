import type { AponiaRouteSource } from "./payloads.types.ts";

/**
 * The binding a record states for one route, or `null` when it states none this
 * release can name.
 *
 * `/routes` and `/flow` state that same fact about the same route, so both read
 * it the same way and here: one reader is one rule about what a record's
 * `source` may say. `"generated"`, `"compiled"`, and `null` are the three values
 * this release writes, and nothing else is a binding state it can publish.
 *
 * The record is data this release did not write — it arrives through a
 * registry-global symbol key, and a foreign copy of the platform answers under
 * it with whatever that copy writes — so a value outside those three is
 * answered as the absence rather than republished. Publishing it verbatim would
 * be the one thing the contract forbids here: a guess or a foreign state placed
 * where a binding this release decided belongs, which would make one boot's
 * routes look interchangeable with another's. The absence is stated as the
 * absence, the way a field a record is too old to carry reads.
 *
 * @internal
 */
export function readRouteSource(value: unknown): AponiaRouteSource {
  return value === "generated" || value === "compiled" ? value : null;
}
