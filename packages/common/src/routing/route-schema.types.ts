import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { StaticDecode } from "typebox/type";
import type { routeSchemaSlots } from "./route-schema.ts";
import type { RouteValidatorInput, ValidationModelClass } from "./validation.types.ts";

/**
 * The marker a TypeBox constructor declares on the type it builds.
 *
 * The four markers are declared as interfaces on purpose. TypeScript gives an
 * anonymous object type an implicit index signature but withholds one from an
 * interface, and the implicit one would make every native validator assignable
 * to `RouteResponseSchemaMap`, collapsing the union `RouteResponseSchema`
 * states and the narrowing `isRouteResponseSchemaMap` performs on it.
 */
interface KindSchema {
  readonly "~kind": string;
}

interface RefineSchema {
  readonly "~refine": unknown;
}

interface CodecSchema {
  readonly "~codec": unknown;
}

interface UnsafeSchema {
  readonly "~unsafe": unknown;
}

/**
 * Platform-native JSON Schema validator: a TypeBox schema, which is what the
 * Elysia `t` builder constructs.
 *
 * TypeBox 1 carries no phantom member describing its inferred value, so a
 * schema is recognized by the markers its own builders declare. `~kind` is on
 * every constructed type; the remaining markers are declared by the modifier
 * wrappers alone — `~unsafe` from `t.Unsafe()` and Elysia's file builders,
 * `~refine` from `t.Refine()`, and `~codec` from `t.Decode()`/`t.Encode()`.
 * This is the same marker set Elysia itself accepts as a schema.
 */
export type ValidatorSchema = KindSchema | RefineSchema | CodecSchema | UnsafeSchema;

/**
 * Any validator a route slot accepts: a Standard Schema implementation such as
 * Zod, ArkType, or Valibot, or a platform-native JSON Schema validator.
 */
export type RouteValidator = StandardSchemaV1 | ValidatorSchema;

/** A status-keyed map of response validators. */
export type RouteResponseSchemaMap = Readonly<Record<number, RouteValidatorInput>>;

/** A `response` slot: one validator for `200`, or a map of statuses to validators. */
export type RouteResponseSchema = RouteValidatorInput | RouteResponseSchemaMap;

/** A route schema: one validator per slot the route declares. */
export interface RouteSchema {
  /** The request body validator. */
  readonly body?: RouteValidatorInput;
  /** The query validator. */
  readonly query?: RouteValidatorInput;
  /** The path-parameter validator. */
  readonly params?: RouteValidatorInput;
  /** The header validator. */
  readonly headers?: RouteValidatorInput;
  /** The cookie validator. */
  readonly cookie?: RouteValidatorInput;
  /** The response validator, or a status-keyed map of them. */
  readonly response?: RouteResponseSchema;
}

/** A route schema slot name. */
export type RouteSchemaSlot = (typeof routeSchemaSlots)[number];

/**
 * Recovers the value a native validator produces. TypeBox computes it from the
 * schema's shape instead of carrying it as a member, so a mapper is the only
 * way to read it. `StaticDecode` is the one the platform itself applies to a
 * request slot, and it is imported as a type only, which leaves `typebox` a
 * compile-time contract with no runtime edge into this package.
 */
type InferValidatorSchemaOutput<TValidator extends ValidatorSchema> = StaticDecode<TValidator>;

/**
 * Recovers the value a validator produces: a Standard Schema's inferred
 * output, a validation-model class's instance fields, or a TypeBox schema's
 * statically decoded value.
 */
export type InferValidatorOutput<TValidator> = TValidator extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TValidator>
  : TValidator extends ValidationModelClass<infer TInstance>
    ? TInstance
    : TValidator extends ValidatorSchema
      ? InferValidatorSchemaOutput<TValidator>
      : unknown;

type InferSlot<
  TSchema extends RouteSchema,
  TSlot extends RouteSchemaSlot,
  TFallback,
> = TSchema[TSlot] extends RouteValidatorInput ? InferValidatorOutput<TSchema[TSlot]> : TFallback;

/**
 * Mutable response settings handed to a handler through `@ResponseSettings()`.
 *
 * There is deliberately no redirect field. The supported platform ignores an
 * assigned redirect and instead completes the request with its own status, so
 * a handler that redirects returns the platform's inline `redirect(url)`
 * helper rather than advertising a setting the substrate does not honour.
 */
export interface ResponseSettingsState {
  /** A status code, or a platform-recognized status name such as "Not Found". */
  status?: number | string;
  headers: Record<string, string | number | string[] | undefined>;
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
 *
 * The platform builds one per request; a handler with no parameter decorators
 * receives the whole context when it declares exactly one parameter.
 */
export interface RouteContext<TSchema extends RouteSchema = RouteSchema> {
  /** The validated body, or `unknown` when the route declares no `body` slot. */
  readonly body: InferSlot<TSchema, "body", unknown>;
  /** The parsed query, typed from the `query` slot when declared. */
  readonly query: InferSlot<TSchema, "query", Record<string, string | undefined>>;
  /** The path parameters, typed from the `params` slot when declared. */
  readonly params: InferSlot<TSchema, "params", Record<string, string>>;
  /** The request headers, typed from the `headers` slot when declared. */
  readonly headers: InferSlot<TSchema, "headers", Record<string, string | undefined>>;
  /** The request cookies, typed from the `cookie` slot when declared. */
  readonly cookie: RouteCookies<TSchema>;
  /** The native `Request` the context was built from. */
  readonly request: Request;
  /** The fully joined route path the request was handled by. */
  readonly path: string;
  /** The mutable response settings the handler answers through. */
  readonly set: ResponseSettingsState;
}
