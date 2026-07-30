import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { RouteResponseSchema, RouteResponseSchemaMap } from "./route-schema.types.ts";
import type { RouteValidatorInput } from "./validation.types.ts";

export const routeSchemaSlots = [
  "body",
  "query",
  "params",
  "headers",
  "cookie",
  "response",
] as const;

export function isStandardSchema(validator: RouteValidatorInput): validator is StandardSchemaV1 {
  return "~standard" in validator;
}

export function isRouteResponseSchemaMap(
  schema: RouteResponseSchema,
): schema is RouteResponseSchemaMap {
  const statuses = Object.keys(schema);
  return statuses.length > 0 && statuses.every((status) => /^\d+$/.test(status));
}
