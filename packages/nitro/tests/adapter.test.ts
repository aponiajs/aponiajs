import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { defineAponiaHandler, toNitroHandler } from "../src/index.ts";

@Controller("users")
class UsersController {
  @Get()
  read(): string {
    return "nitro";
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

const application = await AponiaFactory.create(AppModule, { logger: false });
const handler = toNitroHandler(application);
try {
  test("answers a Nitro server route with the application response", async () => {
    const response = await handler.fetch(new Request("http://localhost/users"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("nitro");
  });

  test("returns a Nitro handler with its fetch entrypoint", () => {
    expect(defineAponiaHandler).toBe(toNitroHandler);
    expect(typeof handler).toBe("function");
    expect(typeof handler.fetch).toBe("function");
  });
} finally {
  await application.close();
}
