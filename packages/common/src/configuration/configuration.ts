import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createToken } from "../tokens/token.ts";
import type { ConfigurationToken } from "./configuration.types.ts";

/**
 * Declares a configuration: the schema its value must satisfy, and the name a
 * failure prints.
 *
 * The declaration is checked when the provider is instantiated, not here: a
 * throw at module evaluation would fail in an import order nobody controls,
 * where a boot failure carries a stable code and a readable message.
 */
export function defineConfiguration<const TSchema extends StandardSchemaV1>(
  schema: TSchema,
  description = "configuration",
): ConfigurationToken<StandardSchemaV1.InferOutput<TSchema>> {
  return Object.freeze({
    ...createToken<StandardSchemaV1.InferOutput<TSchema>>(description),
    schema,
  });
}
