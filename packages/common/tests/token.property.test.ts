import { expect, test } from "bun:test";
import fc from "fast-check";
import { createToken, getTokenName, optionalDependency } from "../src/index.ts";

test("a string token names itself", () => {
  fc.assert(
    fc.property(fc.string(), (value) => {
      expect(getTokenName(value)).toBe(value);
    }),
  );
});

test("a symbol token names its description", () => {
  fc.assert(
    fc.property(fc.string(), (description) => {
      expect(getTokenName(Symbol(description))).toBe(description);
    }),
  );
});

test("an explicit token names its description, optional or not", () => {
  fc.assert(
    fc.property(fc.string(), (description) => {
      const token = createToken<unknown>(description);

      expect(getTokenName(token)).toBe(description);
      expect(getTokenName(optionalDependency(token))).toBe(description);
    }),
  );
});
