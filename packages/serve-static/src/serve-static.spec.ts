import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AponiaError, Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { ServeStaticModule } from "./index.ts";

describe("@aponiajs/serve-static", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serves static files, respects exclusions, supports HEAD and SPA fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-static-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<html>app</html>");
    writeFileSync(join(dir, "assets/app.js"), "console.log('ok');");

    @Controller("api")
    class ApiController {
      @Get("ping")
      ping() {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        ServeStaticModule.forRoot({
          rootPath: dir,
          serveRoot: "/web",
          exclude: ["/api*"],
          renderPath: "*",
        }),
      ],
      controllers: [ApiController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const apiRes = await app.handle(new Request("http://localhost/api/ping"));
      expect(apiRes.status).toBe(200);
      expect(await apiRes.json()).toEqual({ ok: true });

      const jsRes = await app.handle(new Request("http://localhost/web/assets/app.js"));
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toContain("text/javascript");
      expect(await jsRes.text()).toBe("console.log('ok');");

      const headRes = await app.handle(
        new Request("http://localhost/web/assets/app.js", { method: "HEAD" }),
      );
      expect(headRes.status).toBe(200);
      expect(await headRes.text()).toBe("");

      const spaRes = await app.handle(new Request("http://localhost/web/unknown/route"));
      expect(spaRes.status).toBe(200);
      expect(await spaRes.text()).toBe("<html>app</html>");
    } finally {
      await app.close();
    }
  });

  test("supports forRootAsync and rejects empty or invalid rootPath", async () => {
    expect(() => ServeStaticModule.forRoot()).toThrow(AponiaError);
    expect(() => ServeStaticModule.forRoot({ rootPath: "  " })).toThrow(AponiaError);

    const dir = mkdtempSync(join(tmpdir(), "aponia-static-async-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "hello.txt"), "hello");

    @Module({
      imports: [
        ServeStaticModule.forRootAsync({
          useFactory: async () => ({ rootPath: dir }),
        }),
      ],
    })
    class AsyncModule {}

    const app = await AponiaFactory.create(AsyncModule, { logger: false });
    try {
      const res = await app.handle(new Request("http://localhost/hello.txt"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");
    } finally {
      await app.close();
    }
  });

  test("skips non-GET/HEAD requests, supports exact exclude and RegExp/prefix renderPath", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-static-edges-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "empty-dir"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<html>spa</html>");

    @Module({
      imports: [
        ServeStaticModule.forRoot(
          {
            rootPath: dir,
            exclude: ["/blocked"],
            renderPath: /^\/regex-spa/,
            index: false,
          },
          {
            rootPath: dir,
            serveRoot: "/sub",
            renderPath: "/sub/app",
          },
        ),
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const postRes = await app.handle(
        new Request("http://localhost/index.html", { method: "POST" }),
      );
      expect(postRes.status).toBe(404);

      const blockedRes = await app.handle(new Request("http://localhost/blocked/item"));
      expect(blockedRes.status).toBe(404);

      const dirRes = await app.handle(new Request("http://localhost/empty-dir"));
      expect(dirRes.status).toBe(404);

      const regexSpaRes = await app.handle(new Request("http://localhost/regex-spa/dashboard"));
      expect(regexSpaRes.status).toBe(200);
      expect(await regexSpaRes.text()).toBe("<html>spa</html>");

      const prefixSpaRes = await app.handle(new Request("http://localhost/sub/app/settings"));
      expect(prefixSpaRes.status).toBe(200);
      expect(await prefixSpaRes.text()).toBe("<html>spa</html>");
    } finally {
      await app.close();
    }
  });
});
