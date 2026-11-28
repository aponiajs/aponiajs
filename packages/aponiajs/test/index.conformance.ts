import * as facade from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("the Vite+ lane sees an empty reserved facade", () => {
  expect(Object.keys(facade)).toEqual([]);
});
