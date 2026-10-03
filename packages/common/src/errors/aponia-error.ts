import type { AponiaErrorCode } from "./aponia-error.types.ts";

/**
 * The framework failure every internal boundary throws.
 *
 * A code from the closed {@link AponiaErrorCode} union names the failure, and
 * `details` carries its frozen structured facts. Tests assert on `code`,
 * never on message text.
 *
 * @param code - The member of the closed code union naming this failure.
 * @param message - The human sentence naming the failure; never asserted on.
 * @param details - The structured facts of the failure, frozen on construction.
 * @returns An error whose `name` is `"AponiaError"`.
 *
 * @example
 * ```ts
 * throw new AponiaError("MISSING_PROVIDER", `Module "app" cannot resolve "db".`, {
 *   module: "app",
 *   token: "db",
 * });
 * ```
 */
export class AponiaError extends Error {
  readonly code: AponiaErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AponiaErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AponiaError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
