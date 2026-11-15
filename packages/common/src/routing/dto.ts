import type { InferValidatorOutput, RouteValidator } from "./route-schema.types.ts";
import { Validation } from "./validation.ts";

const validationMetadataKey = Symbol.for("aponia.validation.metadata");

/**
 * Infers the output type from a route validator (TypeBox, Zod, Standard Schema)
 * or a DTO constructor.
 */
export type Infer<T> = T extends RouteValidator
  ? InferValidatorOutput<T>
  : T extends { readonly schema: infer S extends RouteValidator }
    ? InferValidatorOutput<S>
    : T extends new (...arguments_: never[]) => infer R
      ? R
      : never;

/**
 * Constructor signature of a class created with `createDto`.
 *
 * Works universally with TypeBox (`t.*`), Zod (`z.*`), ArkType, and Valibot,
 * providing both the typed instance representation and the static schema reference.
 */
export type DtoConstructor<T extends RouteValidator> = (new (
  ...arguments_: never[]
) => InferValidatorOutput<T>) & {
  readonly schema: T;
};

/**
 * Derives a base class constructor from any route validator:
 * TypeBox (`t.*`), Zod (`z.*`), ArkType, or Valibot.
 *
 * Associates the validator with the generated class token and exposes
 * the static schema for metadata resolution and compiler extraction.
 *
 * @param schema - The route validator (TypeBox schema or Standard Schema v1).
 * @returns A constructor that can be extended to create a strongly typed DTO class.
 *
 * @example
 * ```ts
 * // Using TypeBox directly:
 * const UserDto = createDto(t.Object({ id: t.Number(), name: t.String() }));
 *
 * // Using Zod directly:
 * const ProductDto = createDto(z.object({ id: z.number(), title: z.string() }));
 * ```
 */
export function createDto<T extends RouteValidator>(schema: T): DtoConstructor<T> {
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
