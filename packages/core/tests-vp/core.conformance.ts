import { createToken, defineModule, provideFactory, provideValue } from "@aponiajs/common";
import { createContainer } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("core resolves a typed singleton graph in the Vite+ lane", () => {
  const value = createToken<number>("value");
  const doubled = createToken<number>("doubled");
  const module = defineModule({
    id: "core-conformance",
    providers: [
      provideValue(value, 2),
      provideFactory(doubled, [value] as const, (item) => item * 2),
    ],
    exports: [doubled],
  });

  expect(createContainer(module).get(doubled)).toBe(4);
});
