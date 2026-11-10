import { describe, expect, test } from "bun:test";
import { view } from "../src/index.ts";

describe("view() standalone helper", () => {
  test("renders directly to an HTML response with type-safe props", async () => {
    interface WelcomeProps extends Record<string, unknown> {
      readonly user: string;
      readonly count: number;
    }

    const response = await view<WelcomeProps>("<h1>Welcome {{ user }} ({{ count }})</h1>", {
      user: "Ada",
      count: 42,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Welcome Ada (42)");
  });

  test("handles empty props gracefully", async () => {
    const response = await view("<p>Static Page</p>");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Static Page");
  });

  test("uses a custom view engine set explicitly", async () => {
    const { setDefaultViewEngine, HtmlViewEngine } = await import("../src/index.ts");
    setDefaultViewEngine(new HtmlViewEngine());
    const response = await view("<h1>{{ greeting }}</h1>", { greeting: "Hi" });
    expect(await response.text()).toContain("Hi");
  });
});
