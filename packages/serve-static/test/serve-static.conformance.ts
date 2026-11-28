import { describe, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { ServeStaticModule } from "@aponiajs/serve-static";

describe("@aponiajs/serve-static conformance", () => {
  test("serves static files through ServeStaticModule.forRoot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-static-conf-"));
    writeFileSync(join(dir, "info.json"), '{"ok":true}');

    @Module({
      imports: [ServeStaticModule.forRoot({ rootPath: dir })],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const res = await app.handle(new Request("http://localhost/info.json"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
