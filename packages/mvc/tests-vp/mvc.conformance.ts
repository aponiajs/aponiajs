import { Inertia, createInertiaResponse, inertia } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("MVC exports the Inertia protocol for React and Vue", () => {
  expect(typeof Inertia).toBe("function");
  expect(typeof createInertiaResponse).toBe("function");
  expect(typeof inertia).toBe("function");
});
