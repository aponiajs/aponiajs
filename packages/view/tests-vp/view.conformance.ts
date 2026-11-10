import { ViewModule, ViewService, HtmlViewEngine, VIEW_ENGINE } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("ViewModule exports expected members", () => {
  expect(typeof ViewModule.register).toBe("function");
  expect(VIEW_ENGINE).toBeDefined();
  expect(typeof HtmlViewEngine).toBe("function");
  expect(typeof ViewService).toBe("function");
});
