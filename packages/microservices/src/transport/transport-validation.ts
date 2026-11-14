import { AponiaError } from "@aponiajs/common";

/** The maximum length an envelope identifier, target, or transport name may have. */
export const maximumTransportIdentifierLength = 128;

/** The maximum length a broker destination may have. */
export const maximumTransportDestinationLength = 2048;

/** The maximum length a consumer group may have. */
export const maximumTransportGroupLength = 512;

/**
 * Asserts a non-empty bounded string without copying or trimming it.
 *
 * @internal
 */
export function isTransportString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximumLength;
}

/**
 * Builds the one options failure every adapter and runtime reports.
 *
 * The details carry field names only. A configuration object never reaches
 * `details`, because it may hold a password, token, or connection string.
 *
 * @internal
 */
export function invalidMicroserviceOptions(
  subject: string,
  issues: readonly string[],
): AponiaError {
  return new AponiaError(
    "INVALID_MICROSERVICE_OPTIONS",
    `The ${subject} is invalid: ${issues.join("; ")}.`,
    { subject, issues: Object.freeze([...issues]) },
  );
}
