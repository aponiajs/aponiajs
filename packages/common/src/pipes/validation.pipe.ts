import { BadRequestException } from "../exceptions/built-in.exception.ts";
import { isStandardSchema } from "../routing/route-schema.ts";
import { getValidationMetadata, resolveRouteValidator } from "../routing/validation.ts";
import type {
  RouteValidatorInput,
  ValidationModelClass,
} from "../interfaces/validation.interface.ts";
import type { ArgumentMetadata, PipeTransform } from "../interfaces/pipe.interface.ts";

/** One validation failure, shaped the way Nest's `ValidationError` is. */
export interface ValidationError {
  readonly property: string;
  readonly value?: unknown;
  readonly constraints?: Readonly<Record<string, string>>;
  readonly children?: readonly ValidationError[];
}

/** The options Nest's `ValidationPipe` accepts. */
export interface ValidationPipeOptions {
  /** Return the validator's parsed value instead of the original argument. */
  readonly transform?: boolean;
  /** Replace every message with a fixed sentence. */
  readonly disableErrorMessages?: boolean;
  /** Build the thrown value from the validation errors. */
  readonly exceptionFactory?: (errors: readonly ValidationError[]) => unknown;
  /** Shape one issue or group them by property. */
  readonly errorFormat?: "list" | "grouped";
  /** Truncate the message list past this length. */
  readonly maxErrorMessagesLength?: number;
  /** Validate parameters a custom decorator produced. */
  readonly validateCustomDecorators?: boolean;
}

/** The options `StandardSchemaValidationPipe` accepts. */
export interface StandardSchemaValidationPipeOptions {
  /** Return the validator's parsed value instead of the original argument. */
  readonly transform?: boolean;
  /** Build the thrown value from the validation errors. */
  readonly exceptionFactory?: (errors: readonly ValidationError[]) => unknown;
}

/**
 * Validates a parameter against the Standard Schema its `@Validation()` model
 * declares.
 *
 * Nest's `ValidationPipe` reads class-validator metadata. AponiaJS validates
 * with Standard Schema, so this pipe reads the validator the model class
 * already carries and answers the same `400` shape. A parameter type with no
 * validation model, and a primitive type, pass through untouched.
 */
export class ValidationPipe implements PipeTransform {
  readonly #options: ValidationPipeOptions;

  constructor(options: ValidationPipeOptions = {}) {
    this.#options = Object.freeze({ ...options });
  }

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type === "custom" && this.#options.validateCustomDecorators !== true) {
      return value;
    }
    const metatype = metadata.metatype;
    if (metatype === undefined || isPrimitiveType(metatype)) {
      return value;
    }
    if (
      getValidationMetadata(metatype as ValidationModelClass) === undefined &&
      !("schema" in metatype && (metatype as { readonly schema?: unknown }).schema !== undefined)
    ) {
      return value;
    }
    const validator = resolveRouteValidator(metatype as RouteValidatorInput);
    if (!isStandardSchema(validator)) {
      return value;
    }
    return validateWithStandardSchema(value, validator, this.#options);
  }
}

/**
 * Validates a parameter against one Standard Schema validator.
 *
 * The schema is stated directly rather than through a model class, which is the
 * form a route that already declares `{ body }` uses.
 */
export class StandardSchemaValidationPipe implements PipeTransform {
  readonly #validator: unknown;
  readonly #options: StandardSchemaValidationPipeOptions;

  constructor(validator: RouteValidatorInput, options: StandardSchemaValidationPipeOptions = {}) {
    this.#validator = resolveRouteValidator(validator);
    this.#options = Object.freeze({ ...options });
  }

  async transform(value: unknown, _metadata: ArgumentMetadata): Promise<unknown> {
    if (!isStandardSchema(this.#validator)) {
      return value;
    }
    return validateWithStandardSchema(value, this.#validator, this.#options);
  }
}

interface StandardValidationResult {
  readonly value?: unknown;
  readonly issues?: readonly {
    readonly message?: string;
    readonly path?: readonly (string | number | { readonly key: string | number })[];
  }[];
}

async function validateWithStandardSchema(
  value: unknown,
  validator: unknown,
  options: ValidationPipeOptions | StandardSchemaValidationPipeOptions,
): Promise<unknown> {
  const standard = (
    validator as {
      readonly "~standard": {
        readonly validate: (
          value: unknown,
        ) => StandardValidationResult | Promise<StandardValidationResult>;
      };
    }
  )["~standard"];
  const result = await standard.validate(value);
  if (result.issues === undefined || result.issues.length === 0) {
    return options.transform === true ? result.value : value;
  }

  const errors = result.issues.map((issue): ValidationError =>
    Object.freeze({
      property: issue.path?.map(pathKey).join(".") ?? "value",
      constraints: Object.freeze({ validation: issue.message ?? "is invalid" }),
    }),
  );

  if ("exceptionFactory" in options && options.exceptionFactory !== undefined) {
    throw options.exceptionFactory(errors);
  }

  const pipeOptions = options as ValidationPipeOptions;
  const maximum = pipeOptions.maxErrorMessagesLength ?? errors.length;
  const limited = errors.slice(0, maximum);
  const message =
    pipeOptions.disableErrorMessages === true
      ? ["Bad Request"]
      : pipeOptions.errorFormat === "grouped"
        ? Object.fromEntries(limited.map((error) => [error.property, constraintMessage(error)]))
        : limited.map((error) => `${error.property}: ${constraintMessage(error)}`);
  throw new BadRequestException({
    statusCode: 400,
    message,
    error: "Bad Request",
  });
}

function constraintMessage(error: ValidationError): string {
  const constraints = error.constraints;
  return constraints === undefined ? "is invalid" : Object.values(constraints).join(", ");
}

function pathKey(entry: string | number | { readonly key: string | number }): string {
  return String(typeof entry === "object" ? entry.key : entry);
}

function isPrimitiveType(type: unknown): boolean {
  return (
    type === String || type === Number || type === Boolean || type === Array || type === Object
  );
}
