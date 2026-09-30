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

/**
 * Recovers the value a native validator produces. TypeBox computes it from the
 * schema's shape instead of carrying it as a member, so a mapper is the only
 * way to read it. `StaticDecode` is the one the platform itself applies to a
 * request slot, and it is imported as a type only, which leaves `typebox` a
 * compile-time contract with no runtime edge into this package.
 */
type InferValidatorSchemaOutput<TValidator extends ValidatorSchema> = StaticDecode<TValidator>;

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
 */
export interface RouteContext<TSchema extends RouteSchema = RouteSchema> {
  readonly body: InferSlot<TSchema, "body", unknown>;
  readonly query: InferSlot<TSchema, "query", Record<string, string | undefined>>;
  readonly params: InferSlot<TSchema, "params", Record<string, string>>;
  readonly headers: InferSlot<TSchema, "headers", Record<string, string | undefined>>;
  readonly cookie: RouteCookies<TSchema>;
  readonly request: Request;
  readonly path: string;
  readonly set: ResponseSettingsState;
}
