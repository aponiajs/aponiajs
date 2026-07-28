import { expect, test } from "bun:test";
import { Controller, Get, Module, Post, type RouteContext } from "@aponiajs/common";
import { type } from "arktype";
import { t } from "elysia";
import { z } from "zod";
import { AponiaFactory } from "../src/index.ts";

const createUserSchema = {
  body: z.object({
    name: z.string().min(2),
  }),
};

const searchSchema = {
  query: type({
    term: "string",
  }),
};

const typeBoxSchema = {
  body: t.Object({
    quantity: t.Number(),
  }),
};

const responseSchema = {
  response: z.object({
    name: z.string(),
  }),
};

@Controller("users")
class UserController {
  @Post("/", createUserSchema)
  createUser(context: RouteContext<typeof createUserSchema>): { name: string } {
    return { name: context.body.name };
  }

  @Get("search", searchSchema)
  searchUsers(context: RouteContext<typeof searchSchema>): { term: string } {
    return { term: context.query.term };
  }

  @Post("orders", typeBoxSchema)
  createOrder(context: RouteContext<typeof typeBoxSchema>): { quantity: number } {
    return { quantity: context.body.quantity };
  }

  @Get()
  listUsers(): readonly string[] {
    return ["ada"];
  }

  @Get("validated-response", responseSchema)
  readValidatedResponse(): { name: string } {
    return { name: "Ada" };
  }

  @Get("invalid-response", responseSchema)
  readInvalidResponse(): unknown {
    return { name: 42 };
  }
}

@Module({ controllers: [UserController] })
class UserModule {}

async function createApplication() {
  return AponiaFactory.create(UserModule, { logger: false });
}

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("accepts a body matching a Zod schema", async () => {
  const application = await createApplication();
  const response = await application.handle(postJson("/users", { name: "Ada" }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ name: "Ada" });
});

test("rejects a body violating a Zod schema", async () => {
  const application = await createApplication();
  const response = await application.handle(postJson("/users", { name: "A" }));

  expect(response.status).toBe(422);
});

test("validates query input with an ArkType schema", async () => {
  const application = await createApplication();

  const accepted = await application.handle(new Request("http://localhost/users/search?term=ada"));
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ term: "ada" });

  const rejected = await application.handle(new Request("http://localhost/users/search"));
  expect(rejected.status).toBe(422);
});

test("validates a body with a TypeBox schema", async () => {
  const application = await createApplication();

  const accepted = await application.handle(postJson("/users/orders", { quantity: 2 }));
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ quantity: 2 });

  const rejected = await application.handle(postJson("/users/orders", { quantity: "two" }));
  expect(rejected.status).toBe(422);
});

test("keeps routes without a schema working", async () => {
  const application = await createApplication();
  const response = await application.handle(new Request("http://localhost/users"));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(["ada"]);
});

test("validates successful and rejected handler responses", async () => {
  const application = await createApplication();
  const accepted = await application.handle(
    new Request("http://localhost/users/validated-response"),
  );
  const rejected = await application.handle(new Request("http://localhost/users/invalid-response"));

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ name: "Ada" });
  expect(rejected.status).toBe(422);
  await application.close();
});
