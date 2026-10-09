import { expect, test } from "bun:test";
import { Controller, Get, Module, createDto, defineModule } from "@aponiajs/common";
import { treaty, type Treaty } from "@elysia/eden";
import { Elysia, t } from "elysia";
import { z } from "zod";
import {
  AponiaFactory,
  defineController,
  defineControllerRoutes,
  definePlugin,
  controller,
} from "../src/index.ts";

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

const edenUsersController = defineController(EdenUsersController, {
  inject: [] as const,
  buildPlugin: (controller) =>
    new Elysia({ name: "aponia-eden-users" })
      .get(
        "/users/search",
        {
          query: t.Object({ q: t.String() }),
          headers: t.Object({ "x-tenant": t.String() }),
          response: searchResultSchema,
        },
        ({ query, headers }) => controller.search(query.q, headers["x-tenant"]),
      )
      .get(
        "/users/:id",
        {
          params: t.Object({ id: t.Number() }),
          response: {
            200: userSchema,
            404: userNotFoundSchema,
          },
        },
        ({ params, status }) => {
          const user = controller.find(params.id);
          return user ?? status(404, { code: "USER_NOT_FOUND" as const });
        },
      )
      .post(
        "/users",
        {
          body: createUserSchema,
          response: {
            201: userSchema,
          },
        },
        ({ body, status }) => status(201, controller.create(body.name)),
      ),
});

const edenUsersPlugin = edenUsersController.buildPlugin(new EdenUsersController());
const nativeHealthPlugin = new Elysia({ name: "aponia-eden-health" }).get(
  "/health",
  {
    response: t.Object({ status: t.Literal("ok") }),
  },
  () => ({ status: "ok" as const }),
);
const nativeVersionImport = definePlugin(
  new Elysia({ name: "aponia-eden-version" }).get(
    "/version",
    {
      response: t.Object({ channel: t.Literal("alpha") }),
    },
    () => ({ channel: "alpha" as const }),
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

class RegisteredEdenController {
  read(id: number): { id: number; source: "registered" } {
    return { id, source: "registered" };
  }
}

const registeredEdenController = controller(RegisteredEdenController, (application, controller) =>
  application.get(
    "/registered-eden/:id",
    {
      params: t.Object({ id: t.Number() }),
      response: t.Object({
        id: t.Number(),
        source: t.Literal("registered"),
      }),
    },
    ({ params }) => controller.read(params.id),
  ),
);
const registeredEdenModule = defineModule({
  id: "RegisteredEdenModule",
  controllers: [registeredEdenController],
});
const combinedEdenModule = defineModule({
  id: "CombinedEdenModule",
  imports: [nativeVersionImport],
  controllers: [edenUsersController, registeredEdenController],
});

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

function createRegisteredEdenApplication() {
  return AponiaFactory.createNative(registeredEdenModule, {
    logger: false,
  });
}

function createCombinedEdenApplication() {
  return AponiaFactory.createNative(combinedEdenModule, {
    logger: false,
    configureNative: (application) => application.use(nativeHealthPlugin),
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
type RegisteredEdenApplication = Awaited<ReturnType<typeof createRegisteredEdenApplication>>;
type RegisteredEdenClient = Treaty.Create<RegisteredEdenApplication>;
type RegisteredEdenPath = ReturnType<RegisteredEdenClient["registered-eden"]>;
type CombinedEdenApplication = Awaited<ReturnType<typeof createCombinedEdenApplication>>;
type CombinedEdenClient = Treaty.Create<CombinedEdenApplication>;
type CombinedUserPath = ReturnType<CombinedEdenClient["users"]>;
type CombinedRegisteredPath = ReturnType<CombinedEdenClient["registered-eden"]>;
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
  Expect<Equals<Treaty.Data<RegisteredEdenPath["get"]>, { id: number; source: "registered" }>>,
  Expect<Equals<Treaty.Data<CombinedUserPath["get"]>, { id: number; name: string }>>,
  Expect<Equals<Treaty.Data<CombinedRegisteredPath["get"]>, { id: number; source: "registered" }>>,
  Expect<Equals<Treaty.Data<CombinedEdenClient["health"]["get"]>, { status: "ok" }>>,
  Expect<Equals<Treaty.Data<CombinedEdenClient["version"]["get"]>, { channel: "alpha" }>>,
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

function assertInvalidRegisteredEdenCallsAreRejected(client: RegisteredEdenClient): void {
  // @ts-expect-error The registered route requires a numeric path parameter.
  void client["registered-eden"]({ id: true }).get();
  // @ts-expect-error The registered route only exposes GET.
  void client["registered-eden"]({ id: 1 }).post();
}

function assertInvalidRegistrationResultsAreRejected(): void {
  controller(
    RegisteredEdenController,
    // @ts-expect-error A direct registration may only return its Elysia chain or void.
    () => 42,
  );
}

test("keeps the Eden request and response type assertions referenced", () => {
  const assertions: EdenTypeAssertions = Array.from(
    { length: 18 },
    () => true,
  ) as EdenTypeAssertions;

  expect(assertions).toHaveLength(18);
  expect(assertInvalidEdenCallsAreRejected).toBeFunction();
  expect(assertInvalidNativeEdenCallsAreRejected).toBeFunction();
  expect(assertInvalidRegisteredEdenCallsAreRejected).toBeFunction();
  expect(assertInvalidRegistrationResultsAreRejected).toBeFunction();
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

test("preserves a direct registration chain as a native Eden contract", async () => {
  const application = await createRegisteredEdenApplication();
  const client = treaty(application);
  const result = await client["registered-eden"]({ id: 42 }).get();

  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 42, source: "registered" });
});

test("preserves every Eden route across multiple controller styles and plugins", async () => {
  const application = await createCombinedEdenApplication();
  const client = treaty(application);
  const [user, registered, health, version] = await Promise.all([
    client.users({ id: 9 }).get(),
    client["registered-eden"]({ id: 10 }).get(),
    client.health.get(),
    client.version.get(),
  ]);

  expect(user.data).toEqual({ id: 9, name: "user-9" });
  expect(registered.data).toEqual({ id: 10, source: "registered" });
  expect(health.data).toEqual({ status: "ok" });
  expect(version.data).toEqual({ channel: "alpha" });
});

class DeclaredEdenProductController {
  findById(id: number) {
    return { id, title: `product-${id}` };
  }

  createProduct(data: { title: string; price: number }) {
    return { id: 101, title: data.title, price: data.price };
  }
}

const ProductDto = createDto(
  z.object({
    id: z.number(),
    title: z.string(),
  }),
);

const CreateProductDto = createDto(
  z.object({
    title: z.string(),
    price: z.number(),
  }),
);

const declaredProductsController = defineControllerRoutes(DeclaredEdenProductController, {
  path: "products",
  routes: [
    {
      method: "GET",
      path: ":id",
      propertyKey: "findById",
      parameters: [{ index: 0, kind: "params", property: "id" }],
      schema: {
        params: t.Object({ id: t.Number() }),
        response: ProductDto,
      },
    },
    {
      method: "POST",
      path: "",
      propertyKey: "createProduct",
      parameters: [{ index: 0, kind: "body", property: undefined }],
      schema: {
        body: CreateProductDto,
        response: {
          201: t.Object({ id: t.Number(), title: t.String(), price: t.Number() }),
        },
      },
    },
  ] as const,
});

const declaredProductsModule = defineModule({
  id: "DeclaredProductsModule",
  controllers: [declaredProductsController],
});

test("infers full Eden Treaty types from defineControllerRoutes with inline and DTO schemas", async () => {
  const application = await AponiaFactory.createNative(declaredProductsModule, {
    logger: false,
  });
  const client = treaty(application);

  type ClientType = typeof client;
  type ProductGet = ReturnType<ClientType["products"]>["get"];
  type ProductPost = ClientType["products"]["post"];

  type Assertions = [
    Expect<Equals<Treaty.Data<ProductGet>, { id: number; title: string }>>,
    Expect<Equals<Treaty.Data<ProductPost>, { id: number; title: string; price: number }>>,
  ];
  const assertions: Assertions = [true, true];
  expect(assertions).toHaveLength(2);

  const getRes = await client.products({ id: 5 }).get();
  expect(getRes.data).toEqual({ id: 5, title: "product-5" });

  const postRes = await client.products.post({ title: "Widget", price: 29.99 });
  expect(postRes.data).toEqual({ id: 101, title: "Widget", price: 29.99 });

  function assertInvalidProductCalls(c: ClientType) {
    // @ts-expect-error Path param must be a number or string, not boolean
    void c.products({ id: true }).get();
    // @ts-expect-error Post body requires number price
    void c.products.post({ title: "Bad", price: "free" });
  }
  expect(assertInvalidProductCalls).toBeFunction();
});
