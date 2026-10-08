import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { RouteResponseSchema, RouteResponseSchemaMap } from "./route-schema.types.ts";

/**
 * The route schema slots a route decorator accepts, in canonical order.
 *
 * Each slot takes a raw validator or a `@Validation()` model class, except
 * `response`, which also accepts a status-keyed map of validators.
 */
export const routeSchemaSlots = [
  "body",
  "query",
  "params",
  "headers",
  "cookie",
  "response",
] as const;

/**
 * Answers whether a route slot value is a Standard Schema validator.
 *
 * Standard Schema (`~standard`) covers Zod, ArkType, and Valibot; anything
 * else takes the platform-native TypeBox path.
 *
 * @param validator - The slot value to test.
 * @returns `true` when the value carries the Standard Schema marker.
 */
export function isStandardSchema(validator: unknown): validator is StandardSchemaV1 {
  return (
    (typeof validator === "object" && validator !== null && "~standard" in validator) ||
    (typeof validator === "function" && "~standard" in validator)
  );
}

/**
 * Answers whether a `response` slot value is a status-keyed map rather than a
 * single validator.
 *
 * A map is a non-empty object whose keys are all numeric statuses; a single
 * validator answers the `200` slot.
 *
 * @param schema - The `response` slot value to test.
 * @returns `true` when the value maps statuses to validators.
 */
export function isRouteResponseSchemaMap(
  schema: RouteResponseSchema,
): schema is RouteResponseSchemaMap {
  const statuses = Object.keys(schema);
  return statuses.length > 0 && statuses.every((status) => /^\d+$/.test(status));
}
