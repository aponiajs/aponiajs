import { describe, expect, test } from "bun:test";
import { contentDisposition } from "../index.ts";

describe("content disposition", () => {
  test("names a plain ASCII download with both RFC 6266 parameters", () => {
    expect(contentDisposition("attachment", "report.pdf")).toBe(
      "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf",
    );
  });

  test("names an inline render", () => {
    expect(contentDisposition("inline", "report.pdf")).toContain("inline;");
  });

  test("keeps the real name in the extended parameter and a readable fallback", () => {
    expect(contentDisposition("attachment", "café.pdf")).toBe(
      "attachment; filename=\"caf_.pdf\"; filename*=UTF-8''caf%C3%A9.pdf",
    );
  });

  test("escapes a quote in the quoted fallback", () => {
    expect(contentDisposition("attachment", 'a"b.txt')).toContain('filename="a\\"b.txt"');
  });

  for (const [character, label] of [
    ["/", "a path separator"],
    ["\\", "a path separator"],
    ["\n", "a line feed"],
    ["\r", "a carriage return"],
    ["\u0000", "a NUL"],
  ] as const) {
    test(`refuses ${label}`, () => {
      expect(() => contentDisposition("attachment", `a${character}b.txt`)).toThrow(TypeError);
    });
  }
});
