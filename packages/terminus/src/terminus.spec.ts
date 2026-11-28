import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckError,
  HealthCheckService,
  HealthIndicatorService,
  HttpHealthIndicator,
  isHealthCheckMethod,
  MemoryHealthIndicator,
  TerminusModule,
} from "./index.ts";

describe("@aponiajs/terminus", () => {
  test("aggregates healthy indicators and serves 200 OK", async () => {
    @Injectable()
    class CustomIndicator {
      constructor(private readonly indicator: HealthIndicatorService) {}

      isHealthy(key: string) {
        return this.indicator.check(key).up({ region: "local" });
      }
    }

    @Controller("health")
    class HealthController {
      constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly disk: DiskHealthIndicator,
        private readonly custom: CustomIndicator,
      ) {}

      @Get("/")
      @HealthCheck()
      check() {
        return this.health.check([
          () => this.memory.checkHeap("heap", 1024 * 1024 * 1024),
          () => this.memory.checkRSS("rss", 2 * 1024 * 1024 * 1024),
          () => this.disk.checkStorage("disk", { path: "/", thresholdPercent: 0.99 }),
          () => this.custom.isHealthy("custom"),
        ]);
      }
    }

    @Module({
      imports: [TerminusModule.forRoot()],
      controllers: [HealthController],
      providers: [CustomIndicator],
    })
    class AppModule {}

    expect(isHealthCheckMethod(HealthController.prototype, "check")).toBe(true);

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const response = await app.handle(new Request("http://localhost/health"));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        info: Record<string, { status: string }>;
      };
      expect(body.status).toBe("ok");
      expect(body.info["custom"]?.status).toBe("up");
    } finally {
      await app.close();
    }
  });

  test("returns 503 Service Unavailable with error details when an indicator fails", async () => {
    @Controller("health")
    class FailingHealthController {
      constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly indicator: HealthIndicatorService,
      ) {}

      @Get("fail")
      @HealthCheck()
      checkFail() {
        return this.health.check([
          () => this.memory.checkHeap("heap", 1),
          () => this.memory.checkRSS("rss", 1),
          () => this.indicator.check("db").down({ reason: "timeout" }),
          () => {
            throw new Error("unexpected boom");
          },
        ]);
      }
    }

    @Module({
      imports: [TerminusModule.forRootAsync({ useFactory: async () => ({}) })],
      controllers: [FailingHealthController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const response = await app.handle(new Request("http://localhost/health/fail"));
      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        status: string;
        error: Record<string, { status: string }>;
      };
      expect(body.status).toBe("error");
      expect(body.error["heap"]?.status).toBe("down");
      expect(body.error["rss"]?.status).toBe("down");
      expect(body.error["db"]?.status).toBe("down");
    } finally {
      await app.close();
    }
  });

  test("HttpHealthIndicator probes local server and reports failures cleanly", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/fail") {
          return new Response("bad", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      },
    });

    try {
      const http = new HttpHealthIndicator();
      const ok = await http.pingCheck("api", `http://127.0.0.1:${server.port}/ok`);
      expect(ok["api"]?.status).toBe("up");

      let failError: unknown;
      try {
        await http.pingCheck("api", `http://127.0.0.1:${server.port}/fail`);
      } catch (error) {
        failError = error;
      }
      expect(failError).toBeInstanceOf(HealthCheckError);

      let unreachableError: unknown;
      try {
        await http.pingCheck("unreachable", "http://127.0.0.1:1/unreachable", { timeout: 100 });
      } catch (error) {
        unreachableError = error;
      }
      expect(unreachableError).toBeInstanceOf(HealthCheckError);
    } finally {
      await server.stop(true);
    }
  });

  test("DiskHealthIndicator throws HealthCheckError when threshold is exceeded", async () => {
    const disk = new DiskHealthIndicator();
    let diskError: unknown;
    try {
      await disk.checkStorage("disk", { path: "/", threshold: 1 });
    } catch (error) {
      diskError = error;
    }
    expect(diskError).toBeInstanceOf(HealthCheckError);
  });
});
