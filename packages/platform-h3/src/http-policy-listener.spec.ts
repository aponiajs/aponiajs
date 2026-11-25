import { describe, expect, test } from "bun:test";
import { Controller, Get, Module, Version } from "@aponiajs/common";
import { AponiaFactory } from "./index.ts";

@Controller("status")
class StatusController {
  @Get()
  read(): string {
    return "ok";
  }

  @Version("1")
  @Get("versioned")
  versioned(): string {
    return "v1";
  }
}

@Module({ controllers: [StatusController] })
class ListenerModule {}

describe("http policies through the listener", () => {
  test("answers a real request with the declared policies", async () => {
    const application = await AponiaFactory.create(ListenerModule, {
      logger: false,
      securityHeaders: true,
      cors: { origin: "https://app.test" },
    });
    await application.listen(0);
    try {
      const response = await fetch(`${application.getUrl()}/status`, {
        headers: { origin: "https://app.test" },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("access-control-allow-origin")).toBe("https://app.test");
    } finally {
      await application.close(true);
    }
  });

  test("negotiates a version through the listener", async () => {
    const application = await AponiaFactory.create(ListenerModule, {
      logger: false,
      versioning: { type: "header" },
    });
    await application.listen(0);
    try {
      const response = await fetch(`${application.getUrl()}/status/versioned`, {
        headers: { "x-api-version": "1" },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("v1");
    } finally {
      await application.close(true);
    }
  });
});
