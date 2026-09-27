import { describe, expect, test } from "bun:test";
import { renderLogValue } from "../src/index.ts";

/** A value that refers to itself, so `JSON.stringify` refuses it. */
function cyclicRefusal(): Record<string, unknown> {
  const refusal: Record<string, unknown> = {};
  refusal.self = refusal;

  return refusal;
}

/** A value that refuses the plain string form as well as the JSON form. */
function totalRefusal(): Record<string, unknown> {
  const refusal = cyclicRefusal();
  Object.defineProperty(refusal, Symbol.toPrimitive, {
    value: () => {
      throw new TypeError("this value cannot be stated");
    },
  });

  return refusal;
}

describe("renderLogValue", () => {
  test("states each shape a value arrives in", () => {
    function NamedTask(): void {}

    // The branches, one case each: a string is its own text, a function is its
    // name, an `Error` is its name and message and never its stack, and anything
    // else is its JSON form.
    expect(renderLogValue("a message")).toBe("a message");
    expect(renderLogValue(NamedTask)).toBe("NamedTask");
    expect(renderLogValue(new TypeError("the connection was refused"))).toBe(
      "TypeError: the connection was refused",
    );
    expect(renderLogValue({ code: "E_CONN", retries: 3 })).toBe('{"code":"E_CONN","retries":3}');
  });

  test("states an unnamed function and an undefined JSON form by their plain form", () => {
    // A function whose `name` is empty, and a value `JSON.stringify` answers
    // `undefined` for: both fall to the next read rather than to the literal.
    const unnamed = (() => () => {})();
    Object.defineProperty(unnamed, "name", { value: "" });

    expect(renderLogValue(unnamed)).toBe("(anonymous)");
    expect(renderLogValue(undefined)).toBe("undefined");
  });

  test("states a value that refuses the JSON form by its plain string form", () => {
    // A refusal at `JSON.stringify` alone is not a value this release cannot
    // state: the plain form is tried once more before the literal.
    expect(renderLogValue(cyclicRefusal())).toBe("[object Object]");
  });

  test("states a value that refuses every read as the literal", () => {
    expect(renderLogValue(totalRefusal())).toBe("[unrenderable]");
  });
});
