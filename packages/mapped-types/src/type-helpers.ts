import {
  AponiaError,
  getValidationMetadata,
  Validation,
  type RouteValidator,
  type ValidationModelClass,
} from "@aponiajs/common";
import { Type, type TSchema } from "typebox";
import type { ClassConstructor, MappedType } from "./interfaces/mapped-type.interface.ts";

function extractTypeBoxSchema(target: ClassConstructor<unknown>): TSchema | undefined {
  const metadata = getValidationMetadata(target as ValidationModelClass);
  if (metadata !== undefined) {
    return metadata.validator as TSchema;
  }
  const candidate = (target as { readonly schema?: unknown }).schema;
  return typeof candidate === "object" && candidate !== null ? (candidate as TSchema) : undefined;
}

function createDerivedClass<TInstance>(
  base: ClassConstructor<unknown>,
  schema: RouteValidator | undefined,
): MappedType<TInstance> {
  abstract class DerivedDto extends (base as ClassConstructor<object>) {}

  if (schema !== undefined) {
    Validation(schema)(DerivedDto);
    Object.defineProperty(DerivedDto, "schema", {
      value: schema,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  }

  return DerivedDto as unknown as MappedType<TInstance>;
}

/**
 * Derives a DTO class with all properties made optional.
 *
 * @param classRef - The source DTO or `@Validation()` class.
 * @returns A derived DTO class with partial instance typing and schema.
 */
export function PartialType<T>(classRef: ClassConstructor<T>): MappedType<Partial<T>> {
  const source = extractTypeBoxSchema(classRef);
  const derivedSchema =
    source === undefined ? undefined : (Type.Partial(source as never) as RouteValidator);
  return createDerivedClass<Partial<T>>(classRef, derivedSchema);
}

/**
 * Derives a DTO class containing only the selected property keys.
 *
 * @param classRef - The source DTO or `@Validation()` class.
 * @param keys - Property keys to keep.
 * @returns A derived DTO class with picked properties and schema.
 */
export function PickType<T, K extends keyof T & string>(
  classRef: ClassConstructor<T>,
  keys: readonly K[],
): MappedType<Pick<T, K>> {
  const source = extractTypeBoxSchema(classRef);
  const derivedSchema =
    source === undefined ? undefined : (Type.Pick(source as never, [...keys]) as RouteValidator);
  return createDerivedClass<Pick<T, K>>(classRef, derivedSchema);
}

/**
 * Derives a DTO class omitting the specified property keys.
 *
 * @param classRef - The source DTO or `@Validation()` class.
 * @param keys - Property keys to omit.
 * @returns A derived DTO class with omitted properties and schema.
 */
export function OmitType<T, K extends keyof T & string>(
  classRef: ClassConstructor<T>,
  keys: readonly K[],
): MappedType<Omit<T, K>> {
  const source = extractTypeBoxSchema(classRef);
  const derivedSchema =
    source === undefined ? undefined : (Type.Omit(source as never, [...keys]) as RouteValidator);
  return createDerivedClass<Omit<T, K>>(classRef, derivedSchema);
}

/**
 * Derives a DTO class combining two DTO classes via intersection.
 *
 * @param classARef - First source DTO class.
 * @param classBRef - Second source DTO class.
 * @returns A derived DTO class combining both types and schemas.
 */
export function IntersectionType<A, B>(
  classARef: ClassConstructor<A>,
  classBRef: ClassConstructor<B>,
): MappedType<A & B> {
  const schemaA = extractTypeBoxSchema(classARef);
  const schemaB = extractTypeBoxSchema(classBRef);

  if ((schemaA === undefined) !== (schemaB === undefined)) {
    throw new AponiaError(
      "INVALID_VALIDATION_MODEL",
      "IntersectionType requires both classes to declare schemas or neither to declare one.",
      { reason: "mismatched-intersection-schemas" },
    );
  }

  const derivedSchema =
    schemaA !== undefined && schemaB !== undefined
      ? (Type.Intersect([schemaA, schemaB]) as RouteValidator)
      : undefined;

  return createDerivedClass<A & B>(classARef, derivedSchema);
}
