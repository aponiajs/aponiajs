import { expect, test } from "bun:test";
import { Controller, Get, Module, Post, type RouteContext } from "@aponiajs/common";
import { type } from "arktype";
import { t } from "elysia";
import { z } from "zod";
import { AponiaFactory, type ElysiaRouteContext, type ElysiaStatus } from "../src/index.ts";

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

const cookieSchema = {
  cookie: t.Cookie({
    session: t.String({ minLength: 3 }),
  }),
};

const statusResponseSchema = {
  params: t.Object({
    id: t.Numeric(),
  }),
  response: {
    200: t.Object({
      id: t.Number(),
    }),
    404: t.Object({
      code: t.Literal("USER_NOT_FOUND"),
    }),
  },
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

  @Get("session", cookieSchema)
  readSession(context: ElysiaRouteContext<typeof cookieSchema>): { session: string } {
    return { session: context.cookie.session.value };
  }

  @Get("status/:id", statusResponseSchema)
  readStatus(context: ElysiaRouteContext<typeof statusResponseSchema>) {
    return context.params.id === 0
      ? context.status(404, { code: "USER_NOT_FOUND" })
      : { id: context.params.id };
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

test("validates and types cookies through Elysia's native cookie context", async () => {
  const application = await createApplication();
  const accepted = await application.handle(
    new Request("http://localhost/users/session", {
      headers: { cookie: "session=abc" },
    }),
  );
  const rejected = await application.handle(
    new Request("http://localhost/users/session", {
      headers: { cookie: "session=x" },
    }),
  );

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ session: "abc" });
  expect(rejected.status).toBe(422);
  await application.close();
});

test("validates status-specific response schemas and preserves response status", async () => {
  const application = await createApplication();
  const found = await application.handle(new Request("http://localhost/users/status/42"));
  const missing = await application.handle(new Request("http://localhost/users/status/0"));

  expect(found.status).toBe(200);
  expect(await found.json()).toEqual({ id: 42 });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ code: "USER_NOT_FOUND" });
  await application.close();
});

type StatusContext = ElysiaRouteContext<typeof statusResponseSchema>;
type CookieContext = ElysiaRouteContext<typeof cookieSchema>;
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;
type RouteSchemaTypeAssertions = [
  Expect<Equals<CookieContext["cookie"]["session"]["value"], string>>,
  Expect<Equals<ElysiaStatus<typeof statusResponseSchema>, StatusContext["status"]>>,
];

function assertStatusSchemaSafety(status: ElysiaStatus<typeof statusResponseSchema>): void {
  status(200, { id: 1 });
  status(404, { code: "USER_NOT_FOUND" });
  // @ts-expect-error Status 404 requires the declared not-found body.
  status(404, { id: 1 });
  // @ts-expect-error Status 418 is absent from the route response contract.
  status(418, "teapot");
}

test("keeps cookie and response status type assertions referenced", () => {
  const assertions: RouteSchemaTypeAssertions = [true, true];

  expect(assertions).toEqual([true, true]);
  expect(assertStatusSchemaSafety).toBeFunction();
});
