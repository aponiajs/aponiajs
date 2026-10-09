import type { InferValidatorOutput, RequestMethod, RouteSchema } from "@aponiajs/common";
import type { CreateEden, RouteBase } from "elysia/types";
import type { RoutePlan } from "./route-plan.types.ts";

/** Extracts parameter name from a path segment starting with ':' */
export type ExtractParamName<TSegment extends string> = TSegment extends `:${infer TParam}`
  ? TParam
  : never;

/** Parses path parameters from a URL path template (e.g. '/users/:id/comments/:commentId') */
export type ExtractPathParams<TPath extends string> =
  TPath extends `${infer TSegment}/${infer TRest}`
    ? (ExtractParamName<TSegment> extends never
        ? {}
        : { readonly [K in ExtractParamName<TSegment>]: string | number }) &
        ExtractPathParams<TRest>
    : ExtractParamName<TPath> extends never
      ? {}
      : { readonly [K in ExtractParamName<TPath>]: string | number };

type NormalizePrefix<TPrefix extends string> = TPrefix extends `/${infer TRest}`
  ? `/${TRest}`
  : TPrefix extends ""
    ? ""
    : `/${TPrefix}`;

type NormalizePath<TPath extends string> = TPath extends `/${infer TRest}` ? TRest : TPath;

/** Combines a controller path prefix and a route path into a canonical leading-slash path */
export type JoinEdenPath<TPrefix extends string, TPath extends string> =
  NormalizePrefix<TPrefix> extends infer TNormPrefix extends string
    ? NormalizePath<TPath> extends ""
      ? TNormPrefix extends ""
        ? "/"
        : TNormPrefix
      : TNormPrefix extends ""
        ? `/${NormalizePath<TPath>}`
        : `${TNormPrefix}/${NormalizePath<TPath>}`
    : never;

type InferSlot<TSchema, TSlot extends string, TFallback = unknown> = TSchema extends {
  readonly [K in TSlot]?: infer TValidator;
}
  ? [TValidator] extends [undefined]
    ? TFallback
    : InferValidatorOutput<TValidator>
  : TFallback;

type InferResponseSlot<TSchema> = TSchema extends { readonly response?: infer TResponse }
  ? [TResponse] extends [undefined]
    ? { 200: unknown }
    : TResponse extends Readonly<Record<number, unknown>>
      ? {
          readonly [K in keyof TResponse]: InferValidatorOutput<TResponse[K]>;
        }
      : { 200: InferValidatorOutput<TResponse> }
  : { 200: unknown };

type FallbackParams<TPath extends string, TSchema> = TSchema extends { readonly params?: unknown }
  ? InferSlot<TSchema, "params", {}>
  : ExtractPathParams<TPath>;

/** Maps a single RoutePlan into Elysia's CreateEden route tree */
export type RoutePlanToEden<
  TPrefix extends string,
  TPlan extends {
    readonly method: string;
    readonly path?: string;
    readonly schema?: RouteSchema;
  },
> =
  JoinEdenPath<
    TPrefix,
    TPlan["path"] extends string ? TPlan["path"] : ""
  > extends infer TFullPath extends string
    ? CreateEden<
        TFullPath,
        {
          readonly [M in Lowercase<TPlan["method"]>]: {
            readonly params: FallbackParams<TFullPath, TPlan["schema"]>;
            readonly query: InferSlot<TPlan["schema"], "query", {}>;
            readonly headers: InferSlot<TPlan["schema"], "headers", {}>;
            readonly body: InferSlot<TPlan["schema"], "body", undefined>;
            readonly response: InferResponseSlot<TPlan["schema"]>;
          };
        }
      >
    : {};

/**
 * Folds a list of RoutePlans into an intersected Elysia `~Routes` dictionary.
 */
export type InferredEdenRoutes<TPrefix extends string, TRoutes extends readonly unknown[]> = (
  TRoutes extends readonly [infer THead, ...infer TTail]
    ? (THead extends { readonly method: string }
        ? RoutePlanToEden<
            TPrefix,
            THead extends {
              readonly method: string;
              readonly path?: string;
              readonly schema?: RouteSchema;
            }
              ? THead
              : { readonly method: string }
          >
        : {}) &
        InferredEdenRoutes<TPrefix, TTail>
    : {}
) extends infer TRoutesResult extends RouteBase
  ? TRoutesResult
  : RouteBase;

/**
 * A declared route plan carrying compile-time method, path, and schema literals.
 */
export interface TypedRoutePlan<
  TMethod extends string = string,
  TPath extends string = string,
  TSchema extends RouteSchema = RouteSchema,
> extends RoutePlan {
  readonly method: TMethod extends RequestMethod ? TMethod : RequestMethod;
  readonly path: TPath;
  readonly schema?: TSchema;
}
