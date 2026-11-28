import { describe, expect, test } from "vite-plus/test";
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { HealthCheckService, MemoryHealthIndicator, TerminusModule } from "@aponiajs/terminus";

describe("@aponiajs/terminus conformance", () => {
  test("runs MemoryHealthIndicator through HealthCheckService", async () => {
    @Module({
      imports: [TerminusModule.forRoot()],
    })
    class AppModule {}

    const app = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
    try {
      const health = app.get(HealthCheckService);
      const memory = app.get(MemoryHealthIndicator);
      const result = await health.check([() => memory.checkHeap("heap", 2 * 1024 * 1024 * 1024)]);
      expect(result.status).toBe("ok");
    } finally {
      await app.close();
    }
  });
});
