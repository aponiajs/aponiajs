import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory as UnifiedFactory } from "@aponiajs/platform-core";
import { AponiaFactory, elysiaAdapter } from "../index.ts";

@Controller("greetings")
class GreetingController {
  @Get()
  index(): { readonly ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [GreetingController] })
class AppModule {}

describe("the unified factory on Elysia", () => {
  test("delegates to this platform's factory and keeps its native adapter", async () => {
    const application = await UnifiedFactory.create(AppModule, {
      adapter: elysiaAdapter(),
      logger: false,
    });
    const response = await application.handle(new Request("http://localhost/greetings"));

    expect(response.status).toBe(200);
    expect(application.getHttpAdapter()).toBeDefined();
    await application.close();
  });

  test("listen resolves with the application itself and states its address", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const listening = await application.listen(0);

    expect(listening).toBe(application);
    expect(application.getUrl()).toStartWith("http://");
    expect(application.getHttpAdapter()).toBeDefined();
    await application.close();
  });
});
