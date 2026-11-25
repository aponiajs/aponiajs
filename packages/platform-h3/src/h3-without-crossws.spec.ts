import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { createH3Host, loadCrossws } from "./host/h3-host.ts";

@Controller("plain")
class PlainController {
  @Get()
  run(): string {
    return "ok";
  }
}

@Module({ controllers: [PlainController] })
class PlainModule {}

describe("an H3 host without crossws", () => {
  test("states the absence when the adapter module cannot load", async () => {
    expect(
      await loadCrossws(async () => {
        throw new Error("unavailable");
      }),
    ).toBeUndefined();
  });

  test("boots, answers, and listens without websocket support", async () => {
    const application = await createPlatformFactory(createH3Host(null)).create(PlainModule, {
      logger: false,
    });
    const response = await application.handle(new Request("http://localhost/plain"));
    expect(await response.text()).toBe("ok");

    await application.listen(0, { shutdownSignals: false });
    expect(application.getUrl()).toStartWith("http://");
    await application.close();
  });
});
