import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { createHonoHost, loadBunAdapter } from "../src/host/hono-host.ts";

@Controller("plain")
class PlainController {
  @Get()
  run(): string {
    return "ok";
  }
}

@Module({ controllers: [PlainController] })
class PlainModule {}

describe("a Hono host without its Bun adapter", () => {
  test("states the absence when the adapter module cannot load", async () => {
    expect(
      await loadBunAdapter(async () => {
        throw new Error("unavailable");
      }),
    ).toBeUndefined();
  });

  test("boots, answers, and listens without websocket support", async () => {
    const application = await createPlatformFactory(createHonoHost(null)).create(PlainModule, {
      logger: false,
    });
    const response = await application.getNativeApplication().request("/plain");
    expect(await response.text()).toBe("ok");

    await application.listen(0, { shutdownSignals: false });
    expect(application.getUrl()).toStartWith("http://");
    await application.close();
  });
});
