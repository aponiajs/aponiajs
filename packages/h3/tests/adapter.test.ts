import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { H3, toWebHandler } from "h3";
import { toH3Handler } from "../src/index.ts";

@Controller("users")
class UsersController {
  @Get()
  read(): string {
    return "h3";
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

const application = await AponiaFactory.create(AppModule, { logger: false });
const host = new H3().use(toH3Handler(application));
const fetch = toWebHandler(host);
try {
  test("answers through the H3 web handler", async () => {
    const response = await fetch(new Request("http://localhost/users"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("h3");
  });

  test("keeps a missing Aponia route as a 404", async () => {
    const response = await fetch(new Request("http://localhost/missing"));
    expect(response.status).toBe(404);
  });
} finally {
  await application.close();
}
