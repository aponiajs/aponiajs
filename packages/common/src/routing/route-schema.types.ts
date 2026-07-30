import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { routeSchemaSlots } from "./route-schema.ts";
import type { RouteValidatorInput, ValidationModelClass } from "./validation.types.ts";

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

export type RouteResponseSchemaMap = Readonly<Record<number, RouteValidatorInput>>;

export type RouteResponseSchema = RouteValidatorInput | RouteResponseSchemaMap;

export interface RouteSchema {
  readonly body?: RouteValidatorInput;
  readonly query?: RouteValidatorInput;
  readonly params?: RouteValidatorInput;
  readonly headers?: RouteValidatorInput;
  readonly cookie?: RouteValidatorInput;
  readonly response?: RouteResponseSchema;
}

export type RouteSchemaSlot = (typeof routeSchemaSlots)[number];

export type InferValidatorOutput<TValidator> = TValidator extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TValidator>
  : TValidator extends ValidationModelClass<infer TInstance>
    ? TInstance
    : TValidator extends NativeSchema
      ? TValidator["static"]
      : unknown;

type InferSlot<
  TSchema extends RouteSchema,
  TSlot extends RouteSchemaSlot,
  TFallback,
> = TSchema[TSlot] extends RouteValidatorInput ? InferValidatorOutput<TSchema[TSlot]> : TFallback;

export interface RouteResponseSettings {
  /** A status code, or a platform-recognized status name such as "Not Found". */
  status?: number | string;
  headers: Record<string, string | number | string[] | undefined>;
  redirect?: string;
}

/**
 * Platform-neutral view of one request cookie. Platform adapters may add
 * cookie attributes and mutation helpers while preserving this value contract.
 */
export interface RouteCookie<TValue = unknown> {
  value: TValue;
}

type InferCookieValues<TSchema extends RouteSchema> = TSchema["cookie"] extends RouteValidatorInput
  ? InferValidatorOutput<TSchema["cookie"]>
  : {};

type RouteCookies<TSchema extends RouteSchema> = Record<string, RouteCookie<unknown>> &
  (InferCookieValues<TSchema> extends object
    ? {
        [TName in keyof InferCookieValues<TSchema>]-?: RouteCookie<
          InferCookieValues<TSchema>[TName]
        >;
      }
    : {});

/**
 * Request context handed to a decorated route handler. Slots covered by a
 * validator are typed from that validator's output.
 */
export interface RouteContext<TSchema extends RouteSchema = RouteSchema> {
  readonly body: InferSlot<TSchema, "body", unknown>;
  readonly query: InferSlot<TSchema, "query", Record<string, string | undefined>>;
  readonly params: InferSlot<TSchema, "params", Record<string, string>>;
  readonly headers: InferSlot<TSchema, "headers", Record<string, string | undefined>>;
  readonly cookie: RouteCookies<TSchema>;
  readonly request: Request;
  readonly path: string;
  readonly set: RouteResponseSettings;
}
