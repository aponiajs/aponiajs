import { randomUUID } from "node:crypto";

const maxRequestIdLength = 255;
// Printable ASCII characters between 0x21 (!) and 0x7E (~), excluding control characters and whitespace
const printableAsciiPattern = /^[\x21-\x7E]+$/;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * Validates whether an incoming request ID meets safety and printable ASCII constraints.
 */
export function isValidRequestId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (hasControlCharacters(value)) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxRequestIdLength) {
    return false;
  }
  return printableAsciiPattern.test(trimmed);
}

/**
 * Resolves a safe request ID from an incoming header value or generates a fresh one.
 */
export function resolveRequestId(
  headerValue: string | null | undefined,
  generate: () => string = randomUUID,
): string {
  if (headerValue && isValidRequestId(headerValue)) {
    return headerValue.trim();
  }
  return generate();
}
