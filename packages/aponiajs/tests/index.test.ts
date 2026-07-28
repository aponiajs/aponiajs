import { expect, test } from "bun:test";
import * as facade from "../src/index.ts";

test("exports nothing until the facade is designed", () => {
  expect(Object.keys(facade)).toEqual([]);
});
