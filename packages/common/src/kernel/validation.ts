import { isStandardSchema, isValidatorSchema } from "../routing/route-schema.ts";
import { resolveRouteValidator } from "../routing/validation.ts";
import { type RouteSchemaSlot } from "../interfaces/route-schema.interface.ts";
import { type RouteValidatorInput } from "../interfaces/validation.interface.ts";
import { Convert, Parse, ParseError } from "typebox/value";
import { HttpError } from "../exceptions/http-error.ts";

/** One slot refusal: where the request failed and why. */
export interface ValidationIssue {
  /** The route slot that refused. */
  readonly slot: RouteSchemaSlot;
  /** The path inside the slot's value, when the validator stated one. */
  readonly path: string;
  /** The validator's message. */
  readonly message: string;
}

/**
 * Runs one slot's validator over a decoded value.
 *
 * A Standard Schema validator is called through its `~standard` hook; a
 * platform-native validator is parsed with TypeBox's interpreted API, so no
 * function is compiled from the schema at run time. A coerce flag applies to
 * query, path, header, and cookie values, which arrive as strings.
 *
 * @param validator - The declared validator, or `undefined` for an open slot.
 * @param value - The decoded request value.
 * @param slot - The slot the value came from.
 * @param coerce - Whether TypeBox should convert string values to the declared type.
 * @returns The validator's output, or the value when the slot declares none.
 * @throws `HttpError` 422 with code `VALIDATION_ERROR` and the issue list.
 */
export async function validateSlot(
  validator: RouteValidatorInput | undefined,
  value: unknown,
  slot: RouteSchemaSlot,
  coerce: boolean,
): Promise<unknown> {
  if (validator === undefined) {
    return value;
  }

  const resolved = resolveRouteValidator(validator);

  if (isStandardSchema(resolved)) {
    const result = await resolved["~standard"].validate(value);
    if ("issues" in result && result.issues !== undefined) {
      throw validationFailure(
        slot,
        result.issues.map((issue) => ({
          slot,
          path: issue.path === undefined ? "" : issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    return result.value;
  }

  if (isValidatorSchema(resolved)) {
    // `Convert` mutates what it is handed, and the decoded slots are frozen.
    const input =
      coerce && typeof value === "object" && value !== null ? structuredClone(value) : value;
    const candidate = coerce ? Convert(resolved as never, input) : input;
    try {
      return Parse(resolved as never, candidate);
    } catch (error) {
      if (error instanceof ParseError) {
        throw validationFailure(
          slot,
          error.cause.errors.map((issue) => ({
            slot,
            path: issue.instancePath,
            message: issue.message,
          })),
        );
      }
      throw error;
    }
  }

  // A raw validator this framework does not recognize is left to the platform's
  // own lowering; the kernel cannot run it.
  return value;
}

function validationFailure(slot: RouteSchemaSlot, issues: readonly ValidationIssue[]): HttpError {
  return new HttpError("Unprocessable Content", {
    code: "VALIDATION_ERROR",
    detail: `The request "${slot}" did not match the route schema.`,
    extensions: { errors: issues },
  });
}
