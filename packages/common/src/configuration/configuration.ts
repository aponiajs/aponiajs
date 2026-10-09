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
 *
 * @param schema - The Standard Schema the value must satisfy.
 * @param description - The name failures print; defaults to `"configuration"`.
 * @returns A frozen token carrying its schema, the module's `providers` accept.
 *
 * @example
 * ```ts
 * const corsConfig = defineConfiguration(
 *   z.object({ CORS_ORIGINS: z.string().min(1) }),
 *   "cors.config",
 * );
 * ```
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
