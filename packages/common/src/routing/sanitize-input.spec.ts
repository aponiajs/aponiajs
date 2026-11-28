import { describe, expect, test } from "bun:test";
import { stripDangerousKeys } from "./sanitize-input.ts";

describe("stripDangerousKeys", () => {
  test("returns clean objects and arrays by reference with zero allocation", () => {
    const clean = { name: "ada", nested: { tags: ["a", "b"] } };
    expect(stripDangerousKeys(clean)).toBe(clean);

    const date = new Date(0);
    expect(stripDangerousKeys(date)).toBe(date);
    expect(stripDangerousKeys("ok")).toBe("ok");
    expect(stripDangerousKeys(null)).toBeNull();
  });

  test("strips __proto__, constructor, and prototype keys recursively", () => {
    const malicious = JSON.parse(
      '{"cleanFirst":1,"name":"ada","__proto__":{"polluted":true},"constructor":{"x":1},"nested":{"first":true,"prototype":{"y":2},"ok":true},"arr":[{"__proto__":{"z":3},"v":1}]}',
    ) as Record<string, unknown>;

    const cleaned = stripDangerousKeys(malicious);
    expect(cleaned).not.toBe(malicious);
    expect(Object.hasOwn(cleaned, "__proto__")).toBe(false);
    expect(Object.hasOwn(cleaned, "constructor")).toBe(false);
    expect(cleaned.cleanFirst).toBe(1);
    expect(cleaned.name).toBe("ada");
    expect(cleaned.nested).toEqual({ first: true, ok: true });
    expect(cleaned.arr).toEqual([{ v: 1 }]);
    expect(stripDangerousKeys({ nested: JSON.parse('{"__proto__":{"x":1},"a":2}') })).toEqual({
      nested: { a: 2 },
    });
  });

  test("stops recursing at maxDepth", () => {
    const deep = { a: { b: { __proto__: { polluted: true }, ok: 1 } } };
    expect(stripDangerousKeys(deep, 1)).toBe(deep);
  });
});
