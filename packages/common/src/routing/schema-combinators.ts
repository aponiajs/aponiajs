import { AponiaError } from "../errors/aponia-error.ts";
import type { RouteValidator } from "./route-schema.types.ts";

/** The shape a validator must expose for one combinator to call it. */
interface CombinableSchema {
  readonly "~standard"?: unknown;
  readonly shape?: Record<string, unknown>;
  readonly partial?: () => unknown;
  readonly pick?: (mask: Record<string, true>) => unknown;
  readonly omit?: (mask: Record<string, true>) => unknown;
  readonly extend?: (shape: Record<string, unknown>) => unknown;
  readonly merge?: (other: unknown) => unknown;
}

function unsupported(operation: string): AponiaError {
  return new AponiaError(
    "INVALID_VALIDATION_MODEL",
    `This validator does not expose "${operation}". The schema combinators call the validator's own operation; use a validator that defines it.`,
    { operation },
  );
}

function requireStandard(schema: unknown, operation: string): CombinableSchema {
  if (typeof schema !== "object" || schema === null || !("~standard" in schema)) {
    throw new AponiaError(
      "INVALID_VALIDATION_MODEL",
      `The ${operation} helper requires a Standard Schema validator.`,
      { operation },
    );
  }
  return schema as CombinableSchema;
}

function mask(keys: readonly string[]): Record<string, true> {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

/**
 * Derives a validator in which every field is optional.
 *
 * Calls the validator's own `partial()`. Zod and ArkType define it; a validator
 * that does not, such as a TypeBox object schema, is refused with
 * `INVALID_VALIDATION_MODEL` rather than approximated.
 *
 * @param schema - The Standard Schema validator to derive from.
 * @returns The derived validator.
 * @throws An `AponiaError` with `INVALID_VALIDATION_MODEL` when the validator
 * cannot perform the operation.
 */
export function partialSchema<T extends RouteValidator>(schema: T): T {
  const combinable = requireStandard(schema, "partialSchema");
  if (typeof combinable.partial !== "function") {
    throw unsupported("partial");
  }
  return combinable.partial() as T;
}

/**
 * Derives a validator keeping only the named fields.
 *
 * Calls the validator's own `pick()`.
 *
 * @param schema - The Standard Schema validator to derive from.
 * @param keys - The fields to keep.
 * @returns The derived validator.
 * @throws An `AponiaError` with `INVALID_VALIDATION_MODEL` when the validator
 * cannot perform the operation.
 */
export function pickSchema<T extends RouteValidator>(schema: T, keys: readonly string[]): T {
  const combinable = requireStandard(schema, "pickSchema");
  if (typeof combinable.pick !== "function") {
    throw unsupported("pick");
  }
  return combinable.pick(mask(keys)) as T;
}

/**
 * Derives a validator removing the named fields.
 *
 * Calls the validator's own `omit()`.
 *
 * @param schema - The Standard Schema validator to derive from.
 * @param keys - The fields to remove.
 * @returns The derived validator.
 * @throws An `AponiaError` with `INVALID_VALIDATION_MODEL` when the validator
 * cannot perform the operation.
 */
export function omitSchema<T extends RouteValidator>(schema: T, keys: readonly string[]): T {
  const combinable = requireStandard(schema, "omitSchema");
  if (typeof combinable.omit !== "function") {
    throw unsupported("omit");
  }
  return combinable.omit(mask(keys)) as T;
}

/**
 * Derives a validator carrying both validators' fields.
 *
 * Calls `extend()` with the right validator's shape when both expose it, and
 * falls back to `merge()`. It never merges two validators by hand.
 *
 * @param left - The validator whose fields come first.
 * @param right - The validator whose fields are added.
 * @returns The derived validator.
 * @throws An `AponiaError` with `INVALID_VALIDATION_MODEL` when neither
 * operation is available.
 */
export function intersectSchema<A extends RouteValidator, B extends RouteValidator>(
  left: A,
  right: B,
): A {
  const combinable = requireStandard(left, "intersectSchema");
  const rightSchema = requireStandard(right, "intersectSchema");
  if (typeof combinable.extend === "function" && rightSchema.shape !== undefined) {
    return combinable.extend(rightSchema.shape) as A;
  }
  if (typeof combinable.merge === "function") {
    return combinable.merge(right) as A;
  }
  throw unsupported("extend");
}
