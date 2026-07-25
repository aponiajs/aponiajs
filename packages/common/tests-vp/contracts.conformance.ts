import { createToken, defineModule, provideValue } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("common contracts work in the Vite+ lane", () => {
  const value = createToken<number>("value");
  const module = defineModule({
    id: "common-conformance",
    providers: [provideValue(value, 1)],
    exports: [value],
  });

  expect(module.id).toBe("common-conformance");
});
