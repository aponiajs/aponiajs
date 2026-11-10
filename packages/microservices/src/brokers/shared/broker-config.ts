import {
  isTransportString,
  maximumTransportDestinationLength,
  maximumTransportGroupLength,
  maximumTransportIdentifierLength,
} from "../../transport/transport-validation.ts";

/**
 * The characters no supported broker may receive in a destination or prefix.
 *
 * MQTT, NATS, and Redis give these characters routing meaning. A framework
 * destination that contains one would escape the namespace its configuration
 * declares, so every adapter refuses it before the SDK sees it.
 *
 * @internal
 */
const brokerWildcards = /[#+*>]/;

/**
 * Reports the first reason a broker destination is invalid.
 *
 * Destinations are broker addresses rather than handler keys, so they may
 * contain `$`, `~`, `_`, `{`, `}`, and URL punctuation. They may not contain a
 * broker wildcard, whitespace, a control character, a repeated path separator,
 * or more than 2,048 characters.
 *
 * @internal
 */
export function brokerDestinationIssue(value: unknown, field: string): string | undefined {
  if (!isTransportString(value, maximumTransportDestinationLength)) {
    return `${field} must be a non-empty string of at most 2048 characters`;
  }
  if (brokerWildcards.test(value) || /\s/.test(value) || containsControlCharacter(value)) {
    return `${field} must not contain broker wildcards, whitespace, or control characters`;
  }
  if (value.includes("..")) {
    return `${field} must not contain a repeated path separator`;
  }
  return undefined;
}

/**
 * Reports the first reason a broker consumer group or client identifier is invalid.
 *
 * @internal
 */
export function brokerIdentifierIssue(value: unknown, field: string): string | undefined {
  if (!isTransportString(value, maximumTransportIdentifierLength)) {
    return `${field} must be a non-empty string of at most 128 characters`;
  }
  if (/\s/.test(value) || containsControlCharacter(value) || value.includes("..")) {
    return `${field} must not contain whitespace, control characters, or a repeated path separator`;
  }
  return undefined;
}

/**
 * Reports the first reason a broker consumer group is invalid.
 *
 * @internal
 */
export function brokerGroupIssue(value: unknown, field: string): string | undefined {
  if (!isTransportString(value, maximumTransportGroupLength)) {
    return `${field} must be a non-empty string of at most 512 characters`;
  }
  if (
    /\s/.test(value) ||
    containsControlCharacter(value) ||
    value.includes("..") ||
    /[#+*/>:]/u.test(value)
  ) {
    return `${field} must contain only letters, digits, ".", "_", and "-"`;
  }
  return undefined;
}

/**
 * Reports the first reason a positive integer option is invalid.
 *
 * @internal
 */
export function positiveIntegerIssue(value: unknown, field: string): string | undefined {
  if (!Number.isInteger(value) || (value as number) < 1) {
    return `${field} must be a positive integer`;
  }
  return undefined;
}

/**
 * Reports the first reason an optional boolean option is invalid.
 *
 * @internal
 */
export function booleanIssue(value: unknown, field: string): string | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    return `${field} must be a boolean`;
  }
  return undefined;
}

/**
 * Reports the first reason an optional string option is invalid.
 *
 * @internal
 */
export function optionalBrokerStringIssue(
  value: unknown,
  field: string,
  maximumLength = maximumTransportDestinationLength,
): string | undefined {
  if (value !== undefined && !isTransportString(value, maximumLength)) {
    return `${field} must be a non-empty string of at most ${maximumLength} characters`;
  }
  return undefined;
}

/**
 * Collects the issues that are present and returns the frozen option failure.
 *
 * The caller passes field names only. Configuration values never reach
 * `details`, because a connection string or password may be a value.
 *
 * @internal
 */
export function brokerOptionsIssues(issues: readonly (string | undefined)[]): string[] {
  return issues.filter((issue): issue is string => issue !== undefined);
}

/**
 * Reports whether one value carries a C0 or DEL control character.
 *
 * A regular expression covering the same range trips the lint rule that keeps
 * control characters out of patterns, so the check is a direct code-unit scan.
 */
function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}
