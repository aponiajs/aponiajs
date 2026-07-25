export type AponiaErrorCode =
  | "MODULE_CYCLE"
  | "DUPLICATE_MODULE"
  | "DUPLICATE_PROVIDER"
  | "INVALID_EXPORT"
  | "AMBIGUOUS_PROVIDER"
  | "MISSING_PROVIDER"
  | "PROVIDER_CYCLE"
  | "INVALID_CONTROLLER"
  | "INVALID_MODULE"
  | "APPLICATION_NOT_LISTENING"
  | "UNSUPPORTED_CONTROLLER";

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
