import { AponiaError } from "../errors/aponia-error.ts";
import type { ArgumentMetadata, PipeTransform } from "./pipe.types.ts";

/**
 * Options configuring built-in parsing pipes.
 */
export interface ParsePipeOptions {
  /** The HTTP status code to return when validation fails (defaults to 400). */
  readonly errorHttpStatusCode?: number;
  /** Optional custom exception factory when validation fails. */
  readonly exceptionFactory?: (error: string) => unknown;
}

/**
 * Raises the one failure every parsing pipe shares, through the caller's
 * exception factory when one is configured.
 */
function invalidPipeValue(
  value: unknown,
  expected: string,
  message: string,
  metadata: ArgumentMetadata,
  options: ParsePipeOptions,
): never {
  if (options.exceptionFactory) {
    throw options.exceptionFactory(message);
  }
  throw new AponiaError(
    "INVALID_PIPE_VALUE",
    message,
    { value, expected, argument: metadata.data, type: metadata.type },
    options.errorHttpStatusCode ?? 400,
  );
}

/**
 * Transforms string input into an integer or throws an INVALID_PIPE_VALUE failure.
 */
export class ParseIntPipe implements PipeTransform<string | number, number> {
  readonly #options: ParsePipeOptions;

  constructor(options: ParsePipeOptions = {}) {
    this.#options = options;
  }

  transform(value: string | number, metadata: ArgumentMetadata): number {
    if (typeof value === "number") {
      return Math.trunc(value);
    }

    const trimmed = typeof value === "string" ? value.trim() : "";
    const isNumeric = /^-?\d+$/.test(trimmed);

    if (!isNumeric) {
      invalidPipeValue(
        value,
        "integer",
        "Validation failed (numeric string is expected)",
        metadata,
        this.#options,
      );
    }

    return Number.parseInt(trimmed, 10);
  }
}

/**
 * Transforms string input into a floating point number or throws an INVALID_PIPE_VALUE failure.
 */
export class ParseFloatPipe implements PipeTransform<string | number, number> {
  readonly #options: ParsePipeOptions;

  constructor(options: ParsePipeOptions = {}) {
    this.#options = options;
  }

  transform(value: string | number, metadata: ArgumentMetadata): number {
    if (typeof value === "number") {
      return value;
    }

    const trimmed = typeof value === "string" ? value.trim() : "";
    const parsed = Number.parseFloat(trimmed);

    if (trimmed === "" || Number.isNaN(parsed)) {
      invalidPipeValue(
        value,
        "float",
        "Validation failed (numeric string is expected)",
        metadata,
        this.#options,
      );
    }

    return parsed;
  }
}

/**
 * Transforms string boolean representations into a boolean value or throws an INVALID_PIPE_VALUE failure.
 */
export class ParseBoolPipe implements PipeTransform<string | boolean, boolean> {
  readonly #options: ParsePipeOptions;

  constructor(options: ParsePipeOptions = {}) {
    this.#options = options;
  }

  transform(value: string | boolean, metadata: ArgumentMetadata): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0") {
      return false;
    }

    invalidPipeValue(
      value,
      "boolean",
      "Validation failed (boolean string is expected)",
      metadata,
      this.#options,
    );
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that an incoming string matches standard UUID format.
 */
export class ParseUUIDPipe implements PipeTransform<string, string> {
  readonly #options: ParsePipeOptions;

  constructor(options: ParsePipeOptions = {}) {
    this.#options = options;
  }

  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value === "string" && UUID_REGEX.test(value)) {
      return value;
    }

    invalidPipeValue(
      value,
      "uuid",
      "Validation failed (uuid is expected)",
      metadata,
      this.#options,
    );
  }
}

/** The values a `ParseEnumPipe` accepts: an array, or an enum object. */
export type ParseEnumValues =
  | readonly (string | number)[]
  | Readonly<Record<string, string | number>>;

/**
 * Validates that an incoming value is one of a declared set of enum values.
 *
 * A numeric member is matched against its string form, so a query parameter
 * that arrives as `"1"` matches the numeric member `1`.
 */
export class ParseEnumPipe implements PipeTransform<unknown, string | number> {
  readonly #allowed: ReadonlySet<string>;
  readonly #options: ParsePipeOptions;

  constructor(values: ParseEnumValues, options: ParsePipeOptions = {}) {
    const members = Array.isArray(values) ? values : Object.values(values);
    this.#allowed = new Set(members.map((member) => String(member)));
    this.#options = options;
  }

  transform(value: unknown, metadata: ArgumentMetadata): string | number {
    if (
      (typeof value === "string" || typeof value === "number") &&
      this.#allowed.has(String(value))
    ) {
      return value;
    }

    invalidPipeValue(
      value,
      "enum",
      "Validation failed (enum value is expected)",
      metadata,
      this.#options,
    );
  }
}

/** Options configuring `ParseArrayPipe`. */
export interface ParseArrayPipeOptions extends ParsePipeOptions {
  /** The separator a string value is split on. Defaults to `,`. */
  readonly separator?: string;
}

/**
 * Splits a delimited string into an array, or copies an array unchanged.
 *
 * Empty segments are dropped, so `"a,,b"` becomes `["a", "b"]` and an empty
 * string becomes `[]`.
 */
export class ParseArrayPipe implements PipeTransform<unknown, readonly unknown[]> {
  readonly #options: ParseArrayPipeOptions;

  constructor(options: ParseArrayPipeOptions = {}) {
    this.#options = options;
  }

  transform(value: unknown, metadata: ArgumentMetadata): readonly unknown[] {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => (typeof item === "string" ? item.trim() : item)));
    }

    if (typeof value !== "string") {
      invalidPipeValue(
        value,
        "array",
        "Validation failed (array is expected)",
        metadata,
        this.#options,
      );
    }

    const trimmed = value.trim();
    if (trimmed === "") {
      return Object.freeze([]);
    }

    const separator = this.#options.separator ?? ",";
    return Object.freeze(
      trimmed
        .split(separator)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );
  }
}

/** The structural shape an uploaded file must have for `ParseFilePipe`. */
export interface UploadedFileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

/** Options configuring `ParseFilePipe`. */
export interface ParseFilePipeOptions extends ParsePipeOptions {
  /** Whether a missing file is a failure. Defaults to `true`. */
  readonly fileIsRequired?: boolean;
  /** The largest accepted size, in bytes. */
  readonly maxSize?: number;
  /** An accepted media type, a pattern, or a list of accepted types. */
  readonly mimetype?: string | RegExp | readonly string[];
}

/**
 * Validates one uploaded file: presence, maximum size, and media type.
 *
 * The value is read structurally, so a platform `File` satisfies it without
 * this package depending on a DOM or Bun type.
 */
export class ParseFilePipe implements PipeTransform<unknown, UploadedFileLike | undefined> {
  readonly #options: ParseFilePipeOptions;

  constructor(options: ParseFilePipeOptions = {}) {
    this.#options = options;
  }

  transform(value: unknown, metadata: ArgumentMetadata): UploadedFileLike | undefined {
    if (value === undefined || value === null) {
      if (this.#options.fileIsRequired === false) {
        return undefined;
      }
      invalidPipeValue(
        value,
        "file",
        "Validation failed (file is required)",
        metadata,
        this.#options,
      );
    }

    if (!isUploadedFile(value)) {
      invalidPipeValue(
        value,
        "file",
        "Validation failed (file is expected)",
        metadata,
        this.#options,
      );
    }

    const maxSize = this.#options.maxSize;
    if (maxSize !== undefined && value.size > maxSize) {
      invalidPipeValue(
        value,
        "file",
        `Validation failed (file exceeds ${maxSize} bytes)`,
        metadata,
        this.#options,
      );
    }

    const mimetype = this.#options.mimetype;
    if (mimetype !== undefined && !matchesMimetype(value.type, mimetype)) {
      invalidPipeValue(
        value,
        "file",
        "Validation failed (file type is not allowed)",
        metadata,
        this.#options,
      );
    }

    return value;
  }
}

function isUploadedFile(value: unknown): value is UploadedFileLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { name?: unknown; size?: unknown; type?: unknown };
  return (
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.type === "string"
  );
}

function matchesMimetype(actual: string, expected: string | RegExp | readonly string[]): boolean {
  if (typeof expected === "string") {
    return actual === expected;
  }
  return expected instanceof RegExp ? expected.test(actual) : expected.includes(actual);
}

/**
 * Supplies a fallback default value if the incoming argument is null, undefined, or NaN.
 */
export class DefaultValuePipe<T = unknown> implements PipeTransform<unknown, T> {
  readonly #defaultValue: T;

  constructor(defaultValue: T) {
    this.#defaultValue = defaultValue;
  }

  transform(value: unknown): T {
    if (
      value === undefined ||
      value === null ||
      (typeof value === "number" && Number.isNaN(value))
    ) {
      return this.#defaultValue;
    }
    return value as T;
  }
}
