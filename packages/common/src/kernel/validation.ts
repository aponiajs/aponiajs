import { isStandardSchema, isValidatorSchema } from "../routing/route-schema.ts";
import { resolveRouteValidator } from "../routing/validation.ts";
import { type RouteSchemaSlot } from "../interfaces/route-schema.interface.ts";
import { type RouteValidatorInput } from "../interfaces/validation.interface.ts";
import { Compile, type Validator } from "typebox/compile";
import { Convert } from "typebox/value";
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

/** A pre-compiled slot validator that runs synchronously unless a Standard Schema returns a Promise. */
export type CompiledSlotValidator = (value: unknown) => unknown;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function unwrapStandardResult(
  result: {
    readonly issues?: readonly { readonly path?: readonly unknown[]; readonly message: string }[];
    readonly value?: unknown;
  },
  slot: RouteSchemaSlot,
): unknown {
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

/**
 * Compiles one slot's validator once at boot so request dispatch avoids
 * per-request metadata unwrapping, interpreted TypeBox parsing, and `async`
 * allocation on synchronous validators.
 *
 * @internal
 */
export function compileSlotValidator(
  validator: RouteValidatorInput | undefined,
  slot: RouteSchemaSlot,
  coerce: boolean,
): CompiledSlotValidator | undefined {
  if (validator === undefined) {
    return undefined;
  }

  const resolved = resolveRouteValidator(validator);

  if (isStandardSchema(resolved)) {
    const standard = resolved["~standard"];
    return (value: unknown): unknown => {
      const result = standard.validate(value);
      if (isPromiseLike(result)) {
        return result.then((settled) =>
          unwrapStandardResult(
            settled as {
              readonly issues?: readonly {
                readonly path?: readonly unknown[];
                readonly message: string;
              }[];
              readonly value?: unknown;
            },
            slot,
          ),
        );
      }
      return unwrapStandardResult(
        result as {
          readonly issues?: readonly {
            readonly path?: readonly unknown[];
            readonly message: string;
          }[];
          readonly value?: unknown;
        },
        slot,
      );
    };
  }

  if (isValidatorSchema(resolved)) {
    const compiled = Compile(resolved as never) as Validator;
    return (value: unknown): unknown => {
      // `Convert` mutates what it is handed, and decoded query/params/headers are frozen.
      const input =
        coerce && typeof value === "object" && value !== null ? structuredClone(value) : value;
      const candidate = coerce ? Convert(resolved as never, input) : input;
      if (compiled.Check(candidate)) {
        return compiled.Decode(candidate);
      }
      throw validationFailure(
        slot,
        compiled.Errors(candidate).map((issue) => ({
          slot,
          path: issue.instancePath,
          message: issue.message,
        })),
      );
    };
  }

  return undefined;
}

/**
 * Runs one slot's validator over a decoded value.
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
  const compiled = compileSlotValidator(validator, slot, coerce);
  if (compiled === undefined) {
    return value;
  }
  return await compiled(value);
}

function validationFailure(slot: RouteSchemaSlot, issues: readonly ValidationIssue[]): HttpError {
  return new HttpError("Unprocessable Content", {
    code: "VALIDATION_ERROR",
    detail: `The request "${slot}" did not match the route schema.`,
    extensions: { errors: issues },
  });
}
