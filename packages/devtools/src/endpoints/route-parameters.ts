import { routeParameterKinds, type RouteParameterKind } from "@aponiajs/common";
import type { AponiaRouteParameterInspection } from "@aponiajs/platform-elysia";

/**
 * The `@Body`-style bindings a record states for one route, as the payloads
 * publish them.
 *
 * `/routes` and `/flow` publish the same list for the same route, so both read it
 * here: one reader is one rule about what a record's parameter list may say.
 *
 * The record is data this release did not write — it arrives through a
 * registry-global symbol key, and a foreign copy of the platform answers under it
 * with whatever that copy writes — so an entry is published only when it states
 * the three fields this release writes: an index that is a number, a kind the
 * decorators declare, and a property that is a string or absent. A list that is
 * not a list is no list at all, an entry this release cannot read is dropped
 * rather than republished, and the rest of the list is still reported, which is
 * what keeps a foreign entry a lost parameter rather than a lost route.
 *
 * The kinds come from `routeParameterKinds`, the decorators' own list, rather
 * than from a copy here: a second list would be a second rule, and the day one
 * moved the other would publish a kind no decorator declares.
 *
 * @internal
 */
export function readRouteParameters(value: unknown): readonly AponiaRouteParameterInspection[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  const parameters: AponiaRouteParameterInspection[] = [];

  for (const entry of value) {
    const parameter = readParameter(entry);
    if (parameter !== undefined) {
      parameters.push(parameter);
    }
  }

  return Object.freeze(parameters);
}

function readParameter(value: unknown): AponiaRouteParameterInspection | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const { index, kind, property } = value as Record<string, unknown>;

  if (typeof index !== "number" || !isParameterKind(kind)) {
    return undefined;
  }

  return Object.freeze({
    index,
    kind,
    property: typeof property === "string" ? property : undefined,
  });
}

function isParameterKind(value: unknown): value is RouteParameterKind {
  return (routeParameterKinds as readonly unknown[]).includes(value);
}
