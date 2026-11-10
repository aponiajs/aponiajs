import { describe, expect, test } from "bun:test";
import { Render, getViewOptions, getViewTemplate } from "../src/index.ts";

class TestController {
  @Render("home")
  index() {
    return { title: "Welcome" };
  }

  @Render("dashboard", { layout: "admin" })
  admin() {
    return { stats: 100 };
  }

  plain() {
    return "raw";
  }
}

describe("@Render decorator", () => {
  test("records template name and options on method", () => {
    expect(getViewTemplate(TestController.prototype, "index")).toBe("home");
    expect(getViewOptions(TestController.prototype, "index")).toBeUndefined();

    expect(getViewTemplate(TestController.prototype, "admin")).toBe("dashboard");
    expect(getViewOptions(TestController.prototype, "admin")).toEqual({ layout: "admin" });

    expect(getViewTemplate(TestController.prototype, "plain")).toBeUndefined();
  });

  test("rejects invalid template arguments", () => {
    expect(() => Render("")(TestController.prototype, "err", {} as PropertyDescriptor)).toThrow(
      TypeError,
    );
    expect(() =>
      Render(null as never)(TestController.prototype, "err", {} as PropertyDescriptor),
    ).toThrow(TypeError);
  });
});
