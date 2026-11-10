import { describe, expect, test } from "bun:test";
import { ViewModule, ViewService, HtmlViewEngine, VIEW_ENGINE } from "../src/index.ts";

describe("HtmlViewEngine", () => {
  test("substitutes template tokens correctly and caches files", async () => {
    const engine = new HtmlViewEngine();
    const rendered = await engine.render("<h1>Hello {{name}}! Count: <%= count %></h1>", {
      name: "Aponia",
      count: 42,
    });
    expect(rendered).toBe("<h1>Hello Aponia! Count: 42</h1>");

    // Test missing/null/object token substitutions
    const withNulls = await engine.render("Value: {{missing}}, Null: {{nullVal}}, Obj: {{obj}}", {
      nullVal: null,
      obj: { key: "val" },
    });
    expect(withNulls).toContain('Obj: {"key":"val"}');
  });

  test("reads from filesystem if file exists or caches", async () => {
    const engine = new HtmlViewEngine({ cache: true });
    await engine.render("<h1>Cached</h1>", {});
    await engine.render("<h1>Cached</h1>", {});
    const noCache = new HtmlViewEngine({ cache: false });
    const rendered = await noCache.render("<div>Fallback string</div>", {});
    expect(rendered).toBe("<div>Fallback string</div>");
  });
});

describe("ViewModule & ViewService", () => {
  test("creates dynamic module registration with default engine and uses ViewService", async () => {
    const customEngine = new HtmlViewEngine();
    const mod = ViewModule.register({ engine: customEngine });
    expect(mod.providers?.length).toBe(2);
    expect(mod.exports).toContain(VIEW_ENGINE);
    expect(mod.exports).toContain(ViewService);

    const service = new ViewService(customEngine);
    const output = await service.render("Hello {{name}}", { name: "World" });
    expect(output).toBe("Hello World");
  });

  test("selects the Blade engine and shares values through the service", async () => {
    const mod = ViewModule.register({ defaultEngine: "blade" });
    expect(mod.global).toBe(true);
    const service = new ViewService(new HtmlViewEngine());
    service.share("sharedKey", "sharedValue");
    expect(await service.render("Hello", { name: "Aponia" })).toBe("Hello");
  });
});
