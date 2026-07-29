import type { AponiaErrorCode } from "./aponia-error.types.ts";

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
