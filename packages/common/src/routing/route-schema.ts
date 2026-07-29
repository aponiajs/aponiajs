import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { RouteValidator } from "./route-schema.types.ts";

export const routeSchemaSlots = ["body", "query", "params", "headers", "response"] as const;

export function isStandardSchema(validator: RouteValidator): validator is StandardSchemaV1 {
  return "~standard" in validator;
}
