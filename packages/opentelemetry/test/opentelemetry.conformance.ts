import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { MODULE_OPTIONS_TOKEN, OpenTelemetryModule, OpenTelemetryService } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("registers OpenTelemetryModule and exposes OpenTelemetryService", async () => {
  @Controller("ping")
  class PingController {
    @Get()
    ping(): string {
      return "ok";
    }
  }

  @Module({
    imports: [OpenTelemetryModule.forRoot({ serviceName: "conformance-api" })],
    controllers: [PingController],
  })
  class AppModule {}

  const def = OpenTelemetryModule.forRoot();
  expect(def.exports).toContain(MODULE_OPTIONS_TOKEN);

  const app = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const res = await app.handle(new Request("http://localhost/ping"));
    expect(res.status).toBe(200);
    expect(app.get(OpenTelemetryService)).toBeDefined();
  } finally {
    await app.close();
  }
});
