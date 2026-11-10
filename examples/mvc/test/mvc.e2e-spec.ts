import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

test("renders Blade layouts, partials, components, loops, and escaped data", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const home = await application.handle(new Request("http://localhost/"));
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    const homeHtml = await home.text();
    expect(homeHtml).toContain("<title>AponiaJS MVC</title>");
    expect(homeHtml).toContain('<a href="/users">Users</a>');
    expect(homeHtml).toContain(
      '<div class="alert alert-info">Welcome to the Laravel-style MVC example.</div>',
    );

    const users = await application.handle(new Request("http://localhost/users"));
    const usersHtml = await users.text();
    expect(usersHtml).toContain("Total users: 2");
    expect(usersHtml).toContain("Ada (admin)");
    expect(usersHtml).toContain("Linus (member)");

    // Test direct view() helper without decorator
    const direct = await application.handle(new Request("http://localhost/direct-view"));
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-type")).toContain("text/html");
    expect(await direct.text()).toContain("Direct View");
  } finally {
    await application.close();
  }
});

test("answers the Inertia protocol for React and Vue", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const full = await application.handle(new Request("http://localhost/inertia/users"));
    const html = await full.text();
    expect(html).toContain('id="app"');
    expect(html).toContain("Users/Index");

    const spa = await application.handle(
      new Request("http://localhost/inertia/users", {
        headers: { "x-inertia": "true" },
      }),
    );
    expect(spa.headers.get("x-inertia")).toBe("true");
    const page = (await spa.json()) as {
      component: string;
      props: { users: unknown[] };
      url: string;
    };
    expect(page.component).toBe("Users/Index");
    expect(page.props.users).toHaveLength(2);
    expect(page.url).toBe("/inertia/users");

    // Test direct inertia() helper
    const directInertia = await application.handle(
      new Request("http://localhost/direct-inertia", {
        headers: { "x-inertia": "true" },
      }),
    );
    expect(directInertia.headers.get("x-inertia")).toBe("true");
    expect(((await directInertia.json()) as any).component).toBe("Users/Index");
  } finally {
    await application.close();
  }
});
