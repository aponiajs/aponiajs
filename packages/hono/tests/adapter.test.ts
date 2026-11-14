import { expect, test } from "bun:test";
import { Controller, Get, Module, Post, Body } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createHonoApp, toHonoHandler } from "../src/index.ts";
import { Hono } from "hono";

@Controller("users")
class UsersController {
  @Get()
  read(): string {
    return "hono";
  }

  @Post()
  create(@Body() body: { readonly name: string }): string {
    return body.name;
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

const application = await AponiaFactory.create(AppModule, { logger: false });
try {
  test("answers through a Hono app and preserves the request body", async () => {
    const app = createHonoApp(application);
    const read = await app.request("http://localhost/users");
    expect(await read.text()).toBe("hono");
    const created = await app.request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ada" }),
    });
    expect(await created.text()).toBe("ada");
  });

  test("mounts the handler on an existing Hono instance", async () => {
    const app = new Hono();
    app.all("*", toHonoHandler(application));
    expect(await (await app.request("http://localhost/users")).text()).toBe("hono");
  });
} finally {
  await application.close();
}
