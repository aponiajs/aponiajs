import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../index.ts";

@Controller("status")
class StatusController {
  @Get()
  read(): string {
    return "application";
  }
}

@Module({ controllers: [StatusController] })
class StaticModule {}

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

async function boot() {
  root = await mkdtemp(join(tmpdir(), "aponia-static-"));
  await Bun.write(join(root, "index.html"), "<h1>home</h1>");
  await Bun.write(join(root, "app.css"), "body{}");
  return await AponiaFactory.create(StaticModule, {
    logger: false,
    staticAssets: { prefix: "/assets", root, maxAge: 60 },
  });
}

describe("static assets", () => {
  test("serves a file and the directory index under the prefix", async () => {
    const application = await boot();
    try {
      const css = await application.handle(new Request("http://localhost/assets/app.css"));
      expect(css.status).toBe(200);
      expect(await css.text()).toBe("body{}");
      expect(css.headers.get("content-type")).toContain("text/css");
      expect(css.headers.get("cache-control")).toBe("public, max-age=60");

      const home = await application.handle(new Request("http://localhost/assets/"));
      expect(await home.text()).toBe("<h1>home</h1>");
    } finally {
      await application.close();
    }
  });

  test("declines a traversal, a missing file, and a path outside the prefix", async () => {
    const application = await boot();
    try {
      for (const path of ["/assets/%2e%2e/secret", "/assets/none.css", "/other/app.css"]) {
        const response = await application.handle(new Request(`http://localhost${path}`));
        expect(response.status, path).toBe(404);
      }
    } finally {
      await application.close();
    }
  });

  test("leaves the application's own routes alone", async () => {
    const application = await boot();
    try {
      const response = await application.handle(new Request("http://localhost/status"));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("application");
    } finally {
      await application.close();
    }
  });
});
