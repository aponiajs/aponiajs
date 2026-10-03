import "reflect-metadata";
import { AponiaError } from "../errors/aponia-error.ts";
import { isStandardSchema } from "./route-schema.ts";
import type { RouteValidator } from "./route-schema.types.ts";
import type {
  RouteValidatorInput,
  ValidationMetadata,
  ValidationModelClass,
} from "./validation.types.ts";

const validationMetadataKey = Symbol.for("aponia.validation.metadata");

/**
 * Associates one route validator with a named validation-model class.
 *
 * One class carries one schema: create, update, and path-parameter contracts
 * are separate classes rather than several schemas in one decorator.
 *
 * @param validator - The raw validator the route slot receives unchanged.
 * @returns A class decorator recording the frozen validation metadata.
 *
 * @example
 * ```ts
 * @Validation(createUserSchema)
 * class CreateUser {}
 * ```
 */
export function Validation(validator: RouteValidator): ClassDecorator {
  const metadata = Object.freeze({ validator });

  return (target) => {
    Reflect.defineMetadata(validationMetadataKey, metadata, target);
  };
}

/**
 * Returns metadata declared directly on a validation-model class.
 *
 * @param target - The validation-model class to read.
 * @returns The frozen validation metadata, or `undefined` when the class
 * declares none.
 */
export function getValidationMetadata(
  target: ValidationModelClass,
): Readonly<ValidationMetadata> | undefined {
  return Reflect.getOwnMetadata(validationMetadataKey, target) as
    | Readonly<ValidationMetadata>
    | undefined;
}

/**
 * Resolves a raw validator or validation-model class to the original validator
 * instance consumed by a platform adapter.
 *
 * @param input - The raw validator, or the model class declaring one.
 * @returns The validator the route slot receives unchanged.
 * @throws An `AponiaError` with `INVALID_VALIDATION_MODEL` when a class
 * declares no `@Validation()` metadata.
 */
export function resolveRouteValidator(input: RouteValidatorInput): RouteValidator {
  if (isStandardSchema(input)) {
    return input;
  }

  if (typeof input !== "function") {
    return input;
  }

  const metadata = getValidationMetadata(input);
  if (metadata) {
    return metadata.validator;
  }

  throw new AponiaError(
    "INVALID_VALIDATION_MODEL",
    `Validation model "${input.name}" is not decorated with @Validation().`,
    { model: input.name },
  );
}
