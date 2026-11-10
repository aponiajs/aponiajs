import { describe, expect, test } from "bun:test";
import { createInertiaResponse, inertia } from "../src/index.ts";

describe("Inertia protocol", () => {
  test("answers a full-page request with the page payload in #app", async () => {
    const response = createInertiaResponse(
      "Users/Index",
      { users: [{ id: "1", name: "Ada" }] },
      new Request("http://localhost/users?page=2"),
      {
        version: "v1",
        scripts: ["/build/app.js"],
        styles: ["/build/app.css"],
      },
    );

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("vary")).toBe("X-Inertia");
    const html = await response.text();
    expect(html).toContain('id="app"');
    expect(html).toContain("Users/Index");
    expect(html).toContain("/build/app.js");
    expect(html).toContain("/build/app.css");
  });

  test("answers an X-Inertia navigation with the page object as JSON", async () => {
    const response = createInertiaResponse(
      "Users/Index",
      { users: [] },
      new Request("http://localhost/users", { headers: { "x-inertia": "true" } }),
      { version: "v1" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-inertia")).toBe("true");
    expect(response.headers.get("content-type")).toContain("application/json");
    const page = await response.json();
    expect(page).toEqual({
      component: "Users/Index",
      props: { users: [] },
      url: "/users",
      version: "v1",
    });
  });

  test("honours a custom root view placeholder", async () => {
    const response = createInertiaResponse("Home", {}, new Request("http://localhost/"), {
      rootView: "<html><body>{{ inertia }}</body></html>",
    });
    expect(await response.text()).toBe(
      '<html><body><div id="app" data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{},&quot;url&quot;:&quot;/&quot;,&quot;version&quot;:&quot;1&quot;}"></div></body></html>',
    );
  });

  test("builds a response from a handler context", async () => {
    const response = inertia("Home", { ok: true }, { request: new Request("http://localhost/") });
    expect(await response.text()).toContain("Home");
  });
});
