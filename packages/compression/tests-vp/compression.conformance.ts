import { gunzipSync } from "node:zlib";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { CompressionModule, type CompressionModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented compression options", () => {
  const options: CompressionModuleOptions = { thresholdBytes: 1, encodings: ["br", "gzip"] };
  expect(options.thresholdBytes).toBe(1);
});

test("compresses a large response through the mounted plugin", async () => {
  @Controller("large")
  class LargeController {
    @Get()
    read(): string {
      return "a".repeat(2_000);
    }
  }

  @Module({
    imports: [CompressionModule.register({ thresholdBytes: 100, encodings: ["gzip"] })],
    controllers: [LargeController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(
      new Request("http://localhost/large", { headers: { "accept-encoding": "gzip" } }),
    );
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await response.arrayBuffer())).toString()).toBe(
      "a".repeat(2_000),
    );
  } finally {
    await application.close();
  }
});
