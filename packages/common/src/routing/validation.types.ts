import type { RouteValidator } from "./route-schema.types.ts";
import type { ClassToken } from "../tokens/token.types.ts";

/**
 * A class used as a named route-validation contract. The `@Validation()`
 * decorator associates its runtime validator through metadata.
 */
export type ValidationModelClass<TInstance = object> = ClassToken<TInstance>;

/** Immutable metadata recorded for one validation-model class. */
export interface ValidationMetadata {
  readonly validator: RouteValidator;
}

/** A raw route validator or a class associated with one through `@Validation()`. */
export type RouteValidatorInput = RouteValidator | ValidationModelClass;
