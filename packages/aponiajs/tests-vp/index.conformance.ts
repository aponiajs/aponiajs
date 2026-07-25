import { fn } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("the Vite+ test lane can consume the Bun-first package", () => {
  expect(fn()).toBe("Hello, tsdown!");
});
