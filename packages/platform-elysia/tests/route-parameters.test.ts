import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Cookie,
  Ctx,
  Get,
  Headers,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
  type RouteResponseSettings,
} from "@aponiajs/common";
import { t } from "elysia";
import { z } from "zod";
import { AponiaFactory, type ElysiaRouteContext } from "../src/index.ts";

const createUserSchema = { body: z.object({ name: z.string().min(2) }) };
const searchSchema = { query: t.Object({ term: t.String(), take: t.Numeric() }) };

type CreateUser = z.infer<(typeof createUserSchema)["body"]>;

@Injectable()
class UserService {
  createUser(user: CreateUser): { id: number; name: string } {
    return { id: 1, name: user.name };
  }
}

@Controller("users")
class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("/", createUserSchema)
  createUser(@Body() body: CreateUser): { id: number; name: string } {
    return this.userService.createUser(body);
  }

  @Post("named", createUserSchema)
  createNamedUser(@Body("name") name: string): { name: string } {
    return { name };
  }

  @Get("search", searchSchema)
  searchUsers(@Query() query: { term: string; take: number }): { term: string; take: number } {
    return query;
  }

  @Get("search-term", searchSchema)
  searchByTerm(@Query("term") term: string): { term: string } {
    return { term };
  }

  @Get(":id")
  findUser(@Param("id") id: string): { id: string } {
    return { id };
  }

  @Get(":id/agent")
  findAgent(
    @Param("id") id: string,
    @Headers("x-agent") agent: string,
  ): {
    id: string;
    agent: string;
  } {
    return { id, agent };
  }

  @Get("session/current")
  readSession(@Cookie("session") session: string | undefined): { session: string | undefined } {
    return { session };
  }

  @Get("native/request")
  readRequest(@Req() request: Request, @Res() set: RouteResponseSettings): { method: string } {
    set.headers["x-source"] = "parameters";
    return { method: request.method };
  }

  @Post("native/context", createUserSchema)
  readContext(@Ctx() context: ElysiaRouteContext<typeof createUserSchema>) {
    context.set.headers["x-source"] = "context";
    return context.body.name === "root"
      ? context.status(403, "forbidden")
      : { name: context.body.name };
  }
}

@Module({ controllers: [UserController], providers: [UserService] })
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

test("injects the validated body and rejects invalid input", async () => {
  const application = await createApplication();

  const accepted = await application.handle(postJson("/users", { name: "Ada" }));
  expect(await accepted.json()).toEqual({ id: 1, name: "Ada" });

  const rejected = await application.handle(postJson("/users", { name: "A" }));
  expect(rejected.status).toBe(422);
});

test("injects a single body property", async () => {
  const application = await createApplication();
  const response = await application.handle(postJson("/users/named", { name: "Grace" }));

  expect(await response.json()).toEqual({ name: "Grace" });
});

test("injects the coerced query and a single query property", async () => {
  const application = await createApplication();

  const whole = await application.handle(
    new Request("http://localhost/users/search?term=ada&take=2"),
  );
  expect(await whole.json()).toEqual({ term: "ada", take: 2 });

  const single = await application.handle(
    new Request("http://localhost/users/search-term?term=ada&take=2"),
  );
  expect(await single.json()).toEqual({ term: "ada" });
});

test("injects path parameters and headers", async () => {
  const application = await createApplication();

  const found = await application.handle(new Request("http://localhost/users/42"));
  expect(await found.json()).toEqual({ id: "42" });

  const withAgent = await application.handle(
    new Request("http://localhost/users/42/agent", { headers: { "x-agent": "bun" } }),
  );
  expect(await withAgent.json()).toEqual({ id: "42", agent: "bun" });
});

test("injects a cookie value", async () => {
  const application = await createApplication();
  const response = await application.handle(
    new Request("http://localhost/users/session/current", { headers: { cookie: "session=abc" } }),
  );

  expect(await response.json()).toEqual({ session: "abc" });
});

test("injects the native request and response settings", async () => {
  const application = await createApplication();
  const response = await application.handle(new Request("http://localhost/users/native/request"));

  expect(response.headers.get("x-source")).toBe("parameters");
  expect(await response.json()).toEqual({ method: "GET" });
});

test("injects the whole native context", async () => {
  const application = await createApplication();

  const accepted = await application.handle(postJson("/users/native/context", { name: "Ada" }));
  expect(accepted.headers.get("x-source")).toBe("context");
  expect(await accepted.json()).toEqual({ name: "Ada" });

  const forbidden = await application.handle(postJson("/users/native/context", { name: "root" }));
  expect(forbidden.status).toBe(403);
  expect(await forbidden.text()).toBe("forbidden");
});
