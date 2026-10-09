import { describe, expect, test } from "bun:test";
import {
  isValidRequestId,
  resolveRequestId,
} from "../src/request-context/request-context-header.ts";

describe("request context header validation", () => {
  test("accepts valid printable ASCII request IDs up to 255 characters", () => {
    expect(isValidRequestId("abc-123-XYZ")).toBe(true);
    expect(isValidRequestId("req_1234567890")).toBe(true);
    expect(isValidRequestId("client.request:42")).toBe(true);
  });

  test("rejects non-string values", () => {
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(123)).toBe(false);
    expect(isValidRequestId({})).toBe(false);
  });

  test("rejects empty, overlong, or whitespace-only IDs", () => {
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("   ")).toBe(false);
    expect(isValidRequestId("a".repeat(256))).toBe(false);
    expect(isValidRequestId("a".repeat(255))).toBe(true);
  });

  test("rejects IDs with newlines, carriage returns, or control characters", () => {
    expect(isValidRequestId("req-123\r\nInjected-Header: evil")).toBe(false);
    expect(isValidRequestId("req-123\n")).toBe(false);
    expect(isValidRequestId("req-123\r")).toBe(false);
    expect(isValidRequestId("req-\x00-bad")).toBe(false);
    expect(isValidRequestId("req-\x1F-bad")).toBe(false);
    expect(isValidRequestId("req-\x7F-del")).toBe(false);
  });

  test("resolveRequestId returns valid header verbatim or generates a fallback", () => {
    const generator = () => "generated-uuid-42";
    expect(resolveRequestId("valid-client-id", generator)).toBe("valid-client-id");
    expect(resolveRequestId("  valid-with-spaces  ", generator)).toBe("valid-with-spaces");
    expect(resolveRequestId(null, generator)).toBe("generated-uuid-42");
    expect(resolveRequestId(undefined, generator)).toBe("generated-uuid-42");
    expect(resolveRequestId("bad\nid", generator)).toBe("generated-uuid-42");
    expect(resolveRequestId("a".repeat(256), generator)).toBe("generated-uuid-42");
  });

  test("resolveRequestId uses default crypto.randomUUID when generator is omitted", () => {
    const id = resolveRequestId(null);
    expect(typeof id).toBe("string");
    expect(isValidRequestId(id)).toBe(true);
  });
});
