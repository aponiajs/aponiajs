import { randomUUID } from "node:crypto";

const maxRequestIdLength = 255;
const printableAsciiPattern = /^[\x21-\x7E]+$/;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

/** Whether an incoming request ID is printable ASCII and within the bound. */
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

/** Resolves a safe request ID from a header value, or generates a fresh one. */
export function resolveRequestId(
  headerValue: string | null | undefined,
  generate: () => string = randomUUID,
): string {
  if (headerValue && isValidRequestId(headerValue)) {
    return headerValue.trim();
  }
  return generate();
}
