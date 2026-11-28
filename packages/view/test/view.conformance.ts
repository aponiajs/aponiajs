import {
  MODULE_OPTIONS_TOKEN,
  ViewModule,
  ViewService,
  HtmlViewEngine,
  VIEW_ENGINE,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("HtmlViewEngine leaves dotted placeholders as template text", async () => {
  // The engine reads templates through the Bun global, which the Vite+ lane does not provide.
  const hadBun = "Bun" in globalThis;
  const previous = globalThis.Bun;
  Object.defineProperty(globalThis, "Bun", {
    value: { file: () => ({ exists: async () => false, text: async () => "" }) },
    configurable: true,
    writable: true,
  });
  try {
    const engine = new HtmlViewEngine();
    const rendered = await engine.render("<p>{{ user.name }}</p>", { user: { name: "Ada" } });
    expect(rendered).toBe("<p>{{ user.name }}</p>");
  } finally {
    if (hadBun) {
      globalThis.Bun = previous;
    } else {
      Reflect.deleteProperty(globalThis, "Bun");
    }
  }
});

test("ViewModule exports expected members", () => {
  expect(typeof ViewModule.register).toBe("function");
  expect(VIEW_ENGINE).toBeDefined();
  expect(typeof HtmlViewEngine).toBe("function");
  expect(typeof ViewService).toBe("function");
});

test("the registration is a builder definition with an options token and extras", () => {
  const definition = ViewModule.forRoot({ defaultEngine: "html" });
  const asyncDefinition = ViewModule.forRootAsync({
    useFactory: async () => ({ defaultEngine: "html" as const }),
  });

  expect(definition.module).toBe(ViewModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(asyncDefinition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(() => ViewModule.forRoot({ defaultEngine: "handlebars" })).toThrow();
});
