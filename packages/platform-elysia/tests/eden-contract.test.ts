import { expect, test } from "bun:test";
import { Controller, Get, Module, defineModule } from "@aponiajs/common";
import { treaty, type Treaty } from "@elysia/eden";
import { Elysia, t } from "elysia";
import { AponiaFactory, defineElysiaController, defineElysiaPlugin } from "../src/index.ts";

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

const userSchema = t.Object({
  id: t.Number(),
  name: t.String(),
});
const createUserSchema = t.Object({
  name: t.String({ minLength: 2 }),
});
const userNotFoundSchema = t.Object({
  code: t.Literal("USER_NOT_FOUND"),
});
const searchResultSchema = t.Object({
  tenant: t.String(),
  users: t.Array(userSchema),
});

class EdenUsersController {
  find(id: number): { id: number; name: string } | undefined {
    if (id === 0) {
      return undefined;
    }

    return { id, name: `user-${id}` };
  }

  create(name: string): { id: number; name: string } {
    return { id: 43, name };
  }

  search(
    query: string,
    tenant: string,
  ): {
    tenant: string;
    users: { id: number; name: string }[];
  } {
    return {
      tenant,
      users: [{ id: 42, name: query }],
    };
  }
}

const edenUsersController = defineElysiaController(EdenUsersController, {
  inject: [] as const,
  buildPlugin: (controller) =>
    new Elysia({ name: "aponia-eden-users" })
      .get(
        "/users/search",
        ({ query, headers }) => controller.search(query.q, headers["x-tenant"]),
        {
          query: t.Object({ q: t.String() }),
          headers: t.Object({ "x-tenant": t.String() }),
          response: searchResultSchema,
        },
      )
      .get(
        "/users/:id",
        ({ params, status }) => {
          const user = controller.find(params.id);
          return user ?? status(404, { code: "USER_NOT_FOUND" as const });
        },
        {
          params: t.Object({ id: t.Number() }),
          response: {
            200: userSchema,
            404: userNotFoundSchema,
          },
        },
      )
      .post("/users", ({ body, status }) => status(201, controller.create(body.name)), {
        body: createUserSchema,
        response: {
          201: userSchema,
        },
      }),
});

const edenUsersPlugin = edenUsersController.buildPlugin(new EdenUsersController());
const nativeHealthPlugin = new Elysia({ name: "aponia-eden-health" }).get(
  "/health",
  () => ({ status: "ok" as const }),
  {
    response: t.Object({ status: t.Literal("ok") }),
  },
);
const nativeVersionImport = defineElysiaPlugin(
  new Elysia({ name: "aponia-eden-version" }).get(
    "/version",
    () => ({ channel: "alpha" as const }),
    {
      response: t.Object({ channel: t.Literal("alpha") }),
    },
  ),
  { key: "eden-version" },
);
const edenApplication = new Elysia().use(nativeHealthPlugin).use(edenUsersPlugin);
const edenClient = treaty(edenApplication);
const edenUsersModule = defineModule({
  id: "EdenUsersModule",
  imports: [nativeVersionImport],
  controllers: [edenUsersController],
});
const edenRootModule = defineModule({
  id: "EdenRootModule",
  imports: [edenUsersModule],
});

@Controller("runtime-only")
class RuntimeOnlyController {
  @Get()
  read(): { source: "decorator" } {
    return { source: "decorator" };
  }
}

@Module({ controllers: [RuntimeOnlyController] })
class RuntimeOnlyModule {}

function createNativeEdenApplication() {
  return AponiaFactory.createNative(edenRootModule, {
    logger: false,
    configureNative: (application) => application.use(nativeHealthPlugin),
  });
}

function createRuntimeOnlyApplication() {
  return AponiaFactory.createNative(RuntimeOnlyModule, {
    logger: false,
  });
}

const getUser = edenClient.users({ id: 42 }).get;
const createUser = edenClient.users.post;
const searchUsers = edenClient.users.search.get;
const getHealth = edenClient.health.get;

type NativeEdenApplication = Awaited<ReturnType<typeof createNativeEdenApplication>>;
type NativeEdenClient = Treaty.Create<NativeEdenApplication>;
type NativeUsersPath = ReturnType<NativeEdenClient["users"]>;
type NativeGetUser = NativeUsersPath["get"];
type NativeGetVersion = NativeEdenClient["version"]["get"];
type RuntimeOnlyApplication = Awaited<ReturnType<typeof createRuntimeOnlyApplication>>;
type RuntimeOnlyClient = Treaty.Create<RuntimeOnlyApplication>;
type GetUserData = Treaty.Data<typeof getUser>;
type GetUserError = Treaty.Error<typeof getUser>;
type CreateUserData = Treaty.Data<typeof createUser>;
type SearchUsersData = Treaty.Data<typeof searchUsers>;
type HealthData = Treaty.Data<typeof getHealth>;
type NotFoundError = Extract<GetUserError, { status: 404 }>;

type EdenTypeAssertions = [
  Expect<Equals<GetUserData, { id: number; name: string }>>,
  Expect<Equals<NotFoundError["value"], { code: "USER_NOT_FOUND" }>>,
  Expect<Equals<CreateUserData, { id: number; name: string }>>,
  Expect<
    Equals<
      SearchUsersData,
      {
        tenant: string;
        users: { id: number; name: string }[];
      }
    >
  >,
  Expect<Equals<HealthData, { status: "ok" }>>,
  Expect<Equals<"health" extends keyof typeof edenClient ? true : false, true>>,
  Expect<Equals<"users" extends keyof typeof edenClient ? true : false, true>>,
  Expect<Equals<Treaty.Data<NativeGetUser>, { id: number; name: string }>>,
  Expect<Equals<Treaty.Data<NativeGetVersion>, { channel: "alpha" }>>,
  Expect<Equals<"health" extends keyof NativeEdenClient ? true : false, true>>,
  Expect<Equals<"users" extends keyof NativeEdenClient ? true : false, true>>,
  Expect<Equals<"version" extends keyof NativeEdenClient ? true : false, true>>,
  Expect<Equals<"runtime-only" extends keyof RuntimeOnlyClient ? true : false, false>>,
];

function assertInvalidEdenCallsAreRejected(client: typeof edenClient): void {
  // @ts-expect-error Eden serializes path parameters from strings or numbers.
  void client.users({ id: true }).get();
  // @ts-expect-error The create route requires a string name.
  void client.users.post({ name: 42 });
  // @ts-expect-error The search route requires its declared tenant header.
  void client.users.search.get({ query: { q: "Ada" } });
  // @ts-expect-error The health endpoint only exposes GET.
  void client.health.post();
}

function assertInvalidNativeEdenCallsAreRejected(client: NativeEdenClient): void {
  // @ts-expect-error Eden serializes path parameters from strings or numbers.
  void client.users({ id: true }).get();
  // @ts-expect-error The create route requires a string name.
  void client.users.post({ name: 42 });
  // @ts-expect-error The native health endpoint only exposes GET.
  void client.health.post();
  // @ts-expect-error The imported native version endpoint only exposes GET.
  void client.version.post();
}

test("keeps the Eden request and response type assertions referenced", () => {
  const assertions: EdenTypeAssertions = Array.from(
    { length: 13 },
    () => true,
  ) as EdenTypeAssertions;

  expect(assertions).toHaveLength(13);
  expect(assertInvalidEdenCallsAreRejected).toBeFunction();
  expect(assertInvalidNativeEdenCallsAreRejected).toBeFunction();
});

test("calls a parameterized Aponia controller route through Eden Treaty", async () => {
  const result = await edenClient.users({ id: 42 }).get();

  expect(result.status).toBe(200);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 42, name: "user-42" });
});

test("sends a typed request body and keeps a non-default success status", async () => {
  const result = await edenClient.users.post({ name: "Ada" });

  expect(result.status).toBe(201);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 43, name: "Ada" });
});

test("sends typed query and header values through Eden Treaty", async () => {
  const result = await edenClient.users.search.get({
    query: { q: "Ada" },
    headers: { "x-tenant": "acme" },
  });

  expect(result.status).toBe(200);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({
    tenant: "acme",
    users: [{ id: 42, name: "Ada" }],
  });
});

test("narrows a status-specific controller error response", async () => {
  const result = await edenClient.users({ id: 0 }).get();

  expect(result.data).toBeNull();
  expect(result.error?.status).toBe(404);
  if (result.error?.status === 404) {
    expect(result.error.value).toEqual({ code: "USER_NOT_FOUND" });
  }
});

test("rejects an invalid body before the typed controller handler runs", async () => {
  const result = await edenClient.users.post({ name: "A" });

  expect(result.data).toBeNull();
  expect(result.error?.status).toBe(422);
});

test("keeps native and Aponia controller routes in one Eden client", async () => {
  const [health, user] = await Promise.all([
    edenClient.health.get(),
    edenClient.users({ id: 7 }).get(),
  ]);

  expect(health.data).toEqual({ status: "ok" });
  expect(user.data).toEqual({ id: 7, name: "user-7" });
});

test("creates a native Eden application without a contract adapter", async () => {
  const application = await createNativeEdenApplication();
  const client = treaty(application);
  const result = await client.users({ id: 42 }).get();
  const health = await client.health.get();
  const version = await client.version.get();

  expect(application).toBeInstanceOf(Elysia);
  expect(result.status).toBe(200);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 42, name: "user-42" });
  expect(health.data).toEqual({ status: "ok" });
  expect(version.data).toEqual({ channel: "alpha" });
});

test("preserves the same Eden routes through the managed application wrapper", async () => {
  const application = await AponiaFactory.create(edenRootModule, {
    logger: false,
    configureNative: (nativeApplication) => nativeApplication.use(nativeHealthPlugin),
  });
  const client = treaty(application.getNativeApplication());
  const [user, health, version] = await Promise.all([
    client.users({ id: 7 }).get(),
    client.health.get(),
    client.version.get(),
  ]);

  expect(user.data).toEqual({ id: 7, name: "user-7" });
  expect(health.data).toEqual({ status: "ok" });
  expect(version.data).toEqual({ channel: "alpha" });
});

test("runs decorated routes without inventing a static Eden contract", async () => {
  const application = await createRuntimeOnlyApplication();
  const response = await application.handle(new Request("http://localhost/runtime-only"));

  expect(await response.json()).toEqual({ source: "decorator" });
});
