import { expect, test } from "bun:test";
import { Body, Controller, Get, Module, Post } from "@aponiajs/common";
import { AponiaFactory, httpErrors } from "@aponiajs/platform-elysia";
import { defineAponiaHandler, toNitroHandler } from "../src/index.ts";

@Controller("users")
class UsersController {
  @Get()
  read(): string {
    return "nitro";
  }

  @Post()
  create(@Body() body: { readonly name: string }): string {
    return body.name;
  }

  @Get("missing")
  refuse(): string {
    throw httpErrors.notFound("No such user.");
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

  test("preserves a request body and the application's Problem Details", async () => {
    const created = await handler.fetch(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ada" }),
      }),
    );
    expect(await created.text()).toBe("ada");

    const refused = await handler.fetch(new Request("http://localhost/users/missing"));
    expect(refused.status).toBe(404);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
  });
} finally {
  await application.close();
}
