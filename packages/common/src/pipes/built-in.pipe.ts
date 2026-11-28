import { AponiaError } from "../exceptions/aponia-error.ts";
import type { ArgumentMetadata, PipeTransform } from "../interfaces/pipe.interface.ts";

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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES: readonly string[] = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

// `new Date()` separates date parts with any run of spaces, commas, dots,
// slashes, and dashes, and accepts a leading weekday; these patterns read the
// same shapes so a day past its month's end can be refused instead of rolled
// into the next month.
const NAMED_MONTH_DATE_PATTERNS = [
  /^\s*(?:[a-z]+,?\s+)?(?<month>[a-z]{3,})\.?[\s,./-]+(?<day>\d{1,2})[\s,./-]+(?<year>\d{4}|\d{2}(?!:))(?!\d)/i,
  /^\s*(?:[a-z]+,?\s+)?(?<day>\d{1,2})[\s,./-]+(?<month>[a-z]{3,})\.?[\s,./-]+(?<year>\d{4}|\d{2}(?!:))(?!\d)/i,
  /^\s*(?<year>\d{4})[\s,./-]+(?<month>[a-z]{3,})\.?[\s,./-]+(?<day>\d{1,2})(?!\d)/i,
] as const;
const YEAR_FIRST_DATE_PATTERN =
  /^\s*(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?([+-]\d{6}|\d{4})[\s,./-]+(\d{1,2})[\s,./-]+(\d{1,2})(?!\d)/i;
const MONTH_FIRST_DATE_PATTERN =
  /^\s*(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?(\d{1,2})[\s,./-]+(\d{1,2})[\s,./-]+(\d{4}|\d{2}(?!:))(?!\d)/i;

/**
 * Reads a two-digit year as `new Date()` does: below 50 it is in the 2000s,
 * any other value is in the 1900s.
 */
function toFullYear(year: string): number {
  const value = Number(year);
  if (year.length !== 2) {
    return value;
  }
  return value < 50 ? 2000 + value : 1900 + value;
}

/** Reads the year, month, and day of a date whose month is a name. */
function matchNamedMonthDate(value: string): readonly [number, number, number] | undefined {
  for (const pattern of NAMED_MONTH_DATE_PATTERNS) {
    const groups = pattern.exec(value)?.groups as
      | { readonly month: string; readonly day: string; readonly year: string }
      | undefined;
    if (groups === undefined) {
      continue;
    }
    const month = MONTH_NAMES.indexOf(groups.month.slice(0, 3).toLowerCase()) + 1;
    if (month > 0) {
      return [toFullYear(groups.year), month, Number(groups.day)];
    }
  }
  return undefined;
}

/**
 * States whether a date string names a day past the end of its month.
 *
 * `new Date()` rolls such a day into the next month ("2024-02-30" becomes
 * March 1), which is not a date the caller wrote.
 */
function hasDayPastMonthEnd(value: string): boolean {
  let year: number;
  let month: number;
  let day: number;

  const yearFirst = YEAR_FIRST_DATE_PATTERN.exec(value);
  if (yearFirst) {
    year = Number(yearFirst[1]);
    month = Number(yearFirst[2]);
    day = Number(yearFirst[3]);
  } else {
    const monthFirst = MONTH_FIRST_DATE_PATTERN.exec(value);
    if (monthFirst) {
      month = Number(monthFirst[1]);
      day = Number(monthFirst[2]);
      year = toFullYear(monthFirst[3] ?? "");
    } else {
      const named = matchNamedMonthDate(value);
      if (named === undefined) {
        return false;
      }
      [year, month, day] = named;
    }
  }

  // A number above 31 is not read as a day by `new Date()` either.
  if (day > 31) {
    return false;
  }

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = month === 2 && isLeapYear ? 29 : DAYS_IN_MONTH[month - 1];
  return daysInMonth !== undefined && day > daysInMonth;
}

function toDate(value: unknown): Date {
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  if (value instanceof Date) {
    return new Date(value);
  }
  return new Date(Number.NaN);
}

/** Options configuring `ParseDatePipe`. */
export interface ParseDatePipeOptions extends ParsePipeOptions {
  /** Returns `null` or `undefined` unchanged instead of refusing it. */
  readonly optional?: boolean;
  /** Supplies the value a `null` or `undefined` input becomes, whether or not `optional` is set. */
  readonly default?: () => Date;
}

/**
 * Transforms a date string, timestamp, or `Date` into a `Date`.
 *
 * A value that is absent, empty, or not a date fails with `INVALID_PIPE_VALUE`;
 * so does a string naming a day past the end of its month, which `new Date()`
 * would otherwise roll into the next month.
 */
export class ParseDatePipe implements PipeTransform<unknown, Date | null | undefined> {
  readonly #options: ParseDatePipeOptions;

  constructor(options: ParseDatePipeOptions = {}) {
    this.#options = options;
  }

  transform(value: unknown, metadata: ArgumentMetadata): Date | null | undefined {
    if (value === null || value === undefined) {
      if (this.#options.default) {
        return this.#options.default();
      }
      if (this.#options.optional) {
        return value;
      }
    }

    if (value === null || value === undefined || value === "") {
      invalidPipeValue(
        value,
        "date",
        "Validation failed (no Date provided)",
        metadata,
        this.#options,
      );
    }

    const transformed = toDate(value);
    if (
      Number.isNaN(transformed.getTime()) ||
      (typeof value === "string" && hasDayPastMonthEnd(value))
    ) {
      invalidPipeValue(
        value,
        "date",
        "Validation failed (invalid date format)",
        metadata,
        this.#options,
      );
    }

    return transformed;
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
