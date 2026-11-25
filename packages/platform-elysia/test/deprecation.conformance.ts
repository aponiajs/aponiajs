import { Controller, Deprecated, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("answers the standard deprecation headers", async () => {
  @Controller("legacy")
  @Deprecated({ sunset: "2027-01-01T00:00:00Z", link: "https://api.example.com/v2" })
  class LegacyController {
    @Get()
    read(): string {
      return "legacy";
    }
  }

  @Module({ controllers: [LegacyController] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/legacy"));

    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("sunset")).toBe("Fri, 01 Jan 2027 00:00:00 GMT");
    expect(response.headers.get("link")).toBe('<https://api.example.com/v2>; rel="deprecation"');
  } finally {
    await application.close();
  }
});
