import {
  createNextHandler,
  createNuxtHandler,
  createAngularHandler,
  toExpressHandler,
  toFastifyHandler,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("MVC exports all expected multi-engine bridge functions", () => {
  expect(typeof createNextHandler).toBe("function");
  expect(typeof createNuxtHandler).toBe("function");
  expect(typeof createAngularHandler).toBe("function");
  expect(typeof toExpressHandler).toBe("function");
  expect(typeof toFastifyHandler).toBe("function");
});
