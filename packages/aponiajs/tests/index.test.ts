import { expect, test } from "bun:test";
import { fn } from "../src/index.ts";

test("fn", () => {
  expect(fn()).toBe("Hello, tsdown!");
});
