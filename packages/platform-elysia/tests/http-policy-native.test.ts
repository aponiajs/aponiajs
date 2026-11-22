import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

@Controller("status")
class StatusController {
  @Get()
  read(): string {
    return "ok";
  }
}

@Module({ controllers: [StatusController] })
class NativePolicyModule {}

describe("http policies on the native instance", () => {
  test("the native application answers with the declared policies", async () => {
    const application = await AponiaFactory.createNative(NativePolicyModule, {
      logger: false,
      securityHeaders: true,
      etag: true,
    });
    try {
      const response = await application.handle(new Request("http://localhost/status"));
      expect(await response.text()).toBe("ok");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("etag")).toBeString();
    } finally {
      await application.stop();
    }
  });
});
