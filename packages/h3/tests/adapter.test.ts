import { expect, test } from "bun:test";
import { Body, Controller, Get, Module, Post } from "@aponiajs/common";
import { AponiaFactory, httpErrors } from "@aponiajs/platform-elysia";
import { H3, toWebHandler } from "h3";
import { toH3Handler } from "../src/index.ts";

@Controller("users")
class UsersController {
  @Get()
  read(): string {
    return "h3";
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

  test("preserves a request body and the application's Problem Details", async () => {
    const created = await fetch(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ada" }),
      }),
    );
    expect(await created.text()).toBe("ada");

    const refused = await fetch(new Request("http://localhost/users/missing"));
    expect(refused.status).toBe(404);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
  });
} finally {
  await application.close();
}
