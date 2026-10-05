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
      const message = "Validation failed (numeric string is expected)";
      if (this.#options.exceptionFactory) {
        throw this.#options.exceptionFactory(message);
      }
      throw new AponiaError(
        "INVALID_PIPE_VALUE",
        message,
        {
          value,
          expected: "integer",
          argument: metadata.data,
          type: metadata.type,
        },
        this.#options.errorHttpStatusCode ?? 400,
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
      const message = "Validation failed (numeric string is expected)";
      if (this.#options.exceptionFactory) {
        throw this.#options.exceptionFactory(message);
      }
      throw new AponiaError(
        "INVALID_PIPE_VALUE",
        message,
        {
          value,
          expected: "float",
          argument: metadata.data,
          type: metadata.type,
        },
        this.#options.errorHttpStatusCode ?? 400,
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

    const message = "Validation failed (boolean string is expected)";
    if (this.#options.exceptionFactory) {
      throw this.#options.exceptionFactory(message);
    }
    throw new AponiaError(
      "INVALID_PIPE_VALUE",
      message,
      {
        value,
        expected: "boolean",
        argument: metadata.data,
        type: metadata.type,
      },
      this.#options.errorHttpStatusCode ?? 400,
    );
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that an incoming string matches standard UUID v4 format.
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

    const message = "Validation failed (uuid is expected)";
    if (this.#options.exceptionFactory) {
      throw this.#options.exceptionFactory(message);
    }
    throw new AponiaError(
      "INVALID_PIPE_VALUE",
      message,
      {
        value,
        expected: "uuid",
        argument: metadata.data,
        type: metadata.type,
      },
      this.#options.errorHttpStatusCode ?? 400,
    );
  }
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
