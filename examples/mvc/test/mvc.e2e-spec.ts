import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

test("serves full page with layouts on normal browser request", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/articles"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Articles</title>");
    expect(html).toContain('<script src="https://unpkg.com/htmx.org@2.0.4"></script>');
    expect(html).toContain("What is MVC?");
    expect(html).toContain("Modern HTMX Flow");
  } finally {
    await application.close();
  }
});

test("automatically strips layout for HTMX requests without if-conditions in controller", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(
      new Request("http://localhost/articles/decorated", {
        headers: { "hx-request": "true" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    // Layout is automatically stripped for HTMX!
    expect(html).not.toContain("<!doctype html>");
    expect(html).not.toContain("<head>");
    expect(html).toContain('<div id="articles-container">');
    expect(html).toContain("What is MVC?");
  } finally {
    await application.close();
  }
});

test("serves single article detail and returns HTML fragment on delete", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const detail = await application.handle(new Request("http://localhost/articles/1"));
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain("Model-View-Controller in AponiaJS.");

    const deleted = await application.handle(
      new Request("http://localhost/articles/1", { method: "DELETE" }),
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.text()).toBe("<p>Article deleted successfully</p>");
  } finally {
    await application.close();
  }
});
