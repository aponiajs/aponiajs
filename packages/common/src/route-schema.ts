import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Platform-native JSON Schema validator, such as TypeBox or the Elysia `t`
 * builder, which describes its inferred value through a `static` member.
 */
export interface NativeSchema {
  readonly static: unknown;
  readonly params: unknown[];
}

/**
 * Any validator a route slot accepts: a Standard Schema implementation such as
 * Zod, ArkType, or Valibot, or a platform-native JSON Schema validator.
 */
export type RouteValidator = StandardSchemaV1 | NativeSchema;

export interface RouteSchema {
  readonly body?: RouteValidator;
  readonly query?: RouteValidator;
  readonly params?: RouteValidator;
  readonly headers?: RouteValidator;
  readonly response?: RouteValidator;
}

export const routeSchemaSlots = ["body", "query", "params", "headers", "response"] as const;

export type RouteSchemaSlot = (typeof routeSchemaSlots)[number];

export type InferValidatorOutput<TValidator> = TValidator extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TValidator>
  : TValidator extends NativeSchema
    ? TValidator["static"]
    : unknown;

type InferSlot<
  TSchema extends RouteSchema,
  TSlot extends RouteSchemaSlot,
  TFallback,
> = TSchema[TSlot] extends RouteValidator ? InferValidatorOutput<TSchema[TSlot]> : TFallback;

export interface RouteResponseSettings {
  /** A status code, or a platform-recognized status name such as "Not Found". */
  status?: number | string;
  headers: Record<string, string | number | undefined>;
  redirect?: string;
}

/**
 * Request context handed to a decorated route handler. Slots covered by a
 * validator are typed from that validator's output.
 */
export interface RouteContext<TSchema extends RouteSchema = RouteSchema> {
  readonly body: InferSlot<TSchema, "body", unknown>;
  readonly query: InferSlot<TSchema, "query", Record<string, string | undefined>>;
  readonly params: InferSlot<TSchema, "params", Record<string, string>>;
  readonly headers: InferSlot<TSchema, "headers", Record<string, string | undefined>>;
  readonly request: Request;
  readonly path: string;
  readonly set: RouteResponseSettings;
}

export function isStandardSchema(validator: RouteValidator): validator is StandardSchemaV1 {
  return "~standard" in validator;
}
