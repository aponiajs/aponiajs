import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, createAponiaNitroHandler } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("greetings")
class GreetingController {
  @Get()
  index(): { readonly ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [GreetingController] })
class ConformanceModule {}

test("nitro serves a declared route through its handler", async () => {
  const application = await AponiaFactory.create(ConformanceModule, { logger: false });
  const handler = createAponiaNitroHandler(application);
  const response = await handler.fetch?.(new Request("http://localhost/greetings"));

  expect(response?.status).toBe(200);
  expect(application.platform).toBe("nitro");
  await application.close();
});
