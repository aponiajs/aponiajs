import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Validation } from "./validation.ts";

const validationMetadataKey = Symbol.for("aponia.validation.metadata");

/**
 * Infers the output type from a Standard Schema v1 validator.
 */
export type Infer<T> = T extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<T> : never;

/**
 * Constructor signature of a class created with `createDto`.
 *
 * Provides both the typed instance representation and the static schema reference.
 */
export type DtoConstructor<T extends StandardSchemaV1> = {
  new (): StandardSchemaV1.InferOutput<T>;
  readonly schema: T;
};

/**
 * Derives a base class constructor from a Standard Schema v1 validator.
 *
 * Associates the validator with the generated class token and exposes
 * the static schema for metadata resolution and compiler extraction.
 *
 * @param schema - The Standard Schema v1 specification validator.
 * @returns A constructor that can be extended to create a strongly typed DTO class.
 *
 * @example
 * ```ts
 * const UserSchema = z.object({ name: z.string() });
 * class UserDto extends createDto(UserSchema) {}
 * ```
 */
export function createDto<T extends StandardSchemaV1>(schema: T): DtoConstructor<T> {
  class BaseDto {
    constructor() {}
  }
  Validation(schema)(BaseDto);
  Reflect.defineMetadata(validationMetadataKey, schema, BaseDto);
  Object.defineProperty(BaseDto, "schema", {
    value: schema,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  return Object.freeze(BaseDto) as unknown as DtoConstructor<T>;
}
