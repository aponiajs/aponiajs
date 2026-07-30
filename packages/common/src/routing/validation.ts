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
 */
export function Validation(validator: RouteValidator): ClassDecorator {
  const metadata = Object.freeze({ validator });

  return (target) => {
    Reflect.defineMetadata(validationMetadataKey, metadata, target);
  };
}

/**
 * Returns metadata declared directly on a validation-model class.
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
