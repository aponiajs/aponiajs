import { expect, test } from "bun:test";
import {
  AponiaError,
  Body,
  Controller,
  Delete,
  Module,
  Param,
  Patch,
  Post,
  Validation,
  type RouteContext,
  type RouteSchema,
} from "@aponiajs/common";
import { t } from "elysia";
import { z } from "zod";
import { AponiaFactory, type ElysiaRouteContext, type ElysiaStatus } from "../src/index.ts";

const createUserValidator = t.Object({
  name: t.String({ minLength: 2 }),
});

@Validation(createUserValidator)
class CreateUser {
  declare readonly name: string;
}

const updateUserValidator = z.object({
  displayName: z.string().min(3),
});

@Validation(updateUserValidator)
class UpdateUser {
  declare readonly displayName: string;
}

const userParamsValidator = t.Object({
  id: t.Numeric({ minimum: 1 }),
});

@Validation(userParamsValidator)
class UserParams {
  declare readonly id: number;
}

const rawBodyValidator = z.object({
  active: z.literal(true),
});

const createdUserValidator = t.Object({
  id: t.Number(),
  name: t.String(),
});

@Validation(createdUserValidator)
class CreatedUser {
  declare readonly id: number;
  declare readonly name: string;
}

const duplicateUserValidator = z.object({
  code: z.literal("DUPLICATE_USER"),
});

@Validation(duplicateUserValidator)
class DuplicateUser {
  declare readonly code: "DUPLICATE_USER";
}

const createRouteSchema = { body: CreateUser } satisfies RouteSchema;
const updateRouteSchema = {
  body: UpdateUser,
  params: UserParams,
} satisfies RouteSchema;
const paramsRouteSchema = { params: UserParams } satisfies RouteSchema;
const rawRouteSchema = { body: rawBodyValidator } satisfies RouteSchema;
const nativeContextRouteSchema = {
  body: CreateUser,
  params: UserParams,
  response: {
    201: CreatedUser,
    409: DuplicateUser,
  },
} satisfies RouteSchema;
const everyModelSlotSchema = {
  body: CreateUser,
  query: UpdateUser,
  params: UserParams,
  headers: UpdateUser,
  cookie: UpdateUser,
  response: CreatedUser,
} satisfies RouteSchema;

@Controller("validation-users")
class ValidationUserController {
  @Post("/", createRouteSchema)
  create(@Body() body: CreateUser): { operation: "create"; name: string } {
    return { operation: "create", name: body.name };
  }

  @Patch(":id", updateRouteSchema)
  update(
    @Param("id") id: number,
    @Body() body: UpdateUser,
  ): {
    displayName: string;
    id: number;
    operation: "update";
  } {
    return { operation: "update", id, displayName: body.displayName };
  }

  @Delete(":id", paramsRouteSchema)
  remove(@Param("id") id: number): { id: number; operation: "delete" } {
    return { operation: "delete", id };
  }

  @Post("raw", rawRouteSchema)
  useRawSchema(@Body() body: { readonly active: true }): { active: true } {
    return body;
  }

  @Post("native-context/:id", nativeContextRouteSchema)
  createFromNativeContext(context: ElysiaRouteContext<typeof nativeContextRouteSchema>): unknown {
    return context.params.id === 1
      ? context.status(409, { code: "DUPLICATE_USER" })
      : context.status(201, {
          id: context.params.id,
          name: context.body.name,
        });
  }
}

@Module({ controllers: [ValidationUserController] })
class ValidationUserModule {}

function jsonRequest(path: string, method: "PATCH" | "POST", body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("validates native model classes and preserves the original Elysia validators", async () => {
  const application = await AponiaFactory.create(ValidationUserModule, { logger: false });
  const accepted = await application.handle(
    jsonRequest("/validation-users", "POST", { name: "Ada" }),
  );
  const rejected = await application.handle(
    jsonRequest("/validation-users", "POST", { name: "A" }),
  );
  const nativeRoute = application
    .getNativeApplication()
    .router.history.find((route) => route.path === "/validation-users");
  const paramsRoute = application
    .getNativeApplication()
    .router.history.find((route) => route.path === "/validation-users/:id");

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ operation: "create", name: "Ada" });
  expect(rejected.status).toBe(422);
  expect(nativeRoute?.hooks.body).toBe(createUserValidator);
  expect(paramsRoute?.hooks.params).toBe(userParamsValidator);
  await application.close();
});

test("validates separate Standard Schema update models for body and native models for params", async () => {
  const application = await AponiaFactory.create(ValidationUserModule, { logger: false });
  const accepted = await application.handle(
    jsonRequest("/validation-users/42", "PATCH", { displayName: "Ada" }),
  );
  const rejectedBody = await application.handle(
    jsonRequest("/validation-users/42", "PATCH", { displayName: "A" }),
  );
  const rejectedParams = await application.handle(
    jsonRequest("/validation-users/nope", "PATCH", { displayName: "Ada" }),
  );
  const updateRoute = application
    .getNativeApplication()
    .router.history.find(
      (route) => route.method === "PATCH" && route.path === "/validation-users/:id",
    );

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({
    operation: "update",
    id: 42,
    displayName: "Ada",
  });
  expect(rejectedBody.status).toBe(422);
  expect(rejectedParams.status).toBe(422);
  expect(updateRoute?.hooks.body).toBe(updateUserValidator);
  await application.close();
});

test("validates DELETE path params without requiring a request body", async () => {
  const application = await AponiaFactory.create(ValidationUserModule, { logger: false });
  const accepted = await application.handle(
    new Request("http://localhost/validation-users/7", { method: "DELETE" }),
  );
  const rejected = await application.handle(
    new Request("http://localhost/validation-users/0", { method: "DELETE" }),
  );

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ operation: "delete", id: 7 });
  expect(rejected.status).toBe(422);
  await application.close();
});

test("preserves direct raw route validators", async () => {
  const application = await AponiaFactory.create(ValidationUserModule, { logger: false });
  const accepted = await application.handle(
    jsonRequest("/validation-users/raw", "POST", { active: true }),
  );
  const rejected = await application.handle(
    jsonRequest("/validation-users/raw", "POST", { active: false }),
  );
  const rawRoute = application
    .getNativeApplication()
    .router.history.find((route) => route.path === "/validation-users/raw");

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ active: true });
  expect(rejected.status).toBe(422);
  expect(rawRoute?.hooks.body).toBe(rawBodyValidator);
  await application.close();
});

test("types native context and lowers status-specific response model classes", async () => {
  const application = await AponiaFactory.create(ValidationUserModule, { logger: false });
  const created = await application.handle(
    jsonRequest("/validation-users/native-context/2", "POST", { name: "Ada" }),
  );
  const duplicate = await application.handle(
    jsonRequest("/validation-users/native-context/1", "POST", { name: "Ada" }),
  );
  const rejected = await application.handle(
    jsonRequest("/validation-users/native-context/2", "POST", { name: "A" }),
  );
  const route = application
    .getNativeApplication()
    .router.history.find((candidate) => candidate.path === "/validation-users/native-context/:id");
  const responses = route?.hooks.response as Readonly<Record<number, unknown>> | undefined;

  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: 2, name: "Ada" });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ code: "DUPLICATE_USER" });
  expect(rejected.status).toBe(422);
  expect(route?.hooks.body).toBe(createUserValidator);
  expect(route?.hooks.params).toBe(userParamsValidator);
  expect(responses?.[201]).toBe(createdUserValidator);
  expect(responses?.[409]).toBe(duplicateUserValidator);
  await application.close();
});

class UndecoratedBody {
  declare readonly name: string;
}

@Controller("invalid-validation-model")
class InvalidValidationModelController {
  @Post("/", { body: UndecoratedBody })
  create(@Body() body: UndecoratedBody): UndecoratedBody {
    return body;
  }
}

@Module({ controllers: [InvalidValidationModelController] })
class InvalidValidationModelModule {}

test("rejects an undecorated class with a structured bootstrap error", async () => {
  const error = await AponiaFactory.create(InvalidValidationModelModule, {
    logger: false,
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(AponiaError);
  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_VALIDATION_MODEL",
      details: expect.any(Object),
    }),
  );
  expect(Object.isFrozen((error as AponiaError).details)).toBe(true);
});

type CreateContext = RouteContext<typeof createRouteSchema>;
type UpdateContext = RouteContext<typeof updateRouteSchema>;
type NativeContext = ElysiaRouteContext<typeof nativeContextRouteSchema>;
type EveryModelSlotContext = ElysiaRouteContext<typeof everyModelSlotSchema>;
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;
type ValidationModelTypeAssertions = [
  Expect<Equals<CreateContext["body"]["name"], string>>,
  Expect<Equals<UpdateContext["body"]["displayName"], string>>,
  Expect<Equals<UpdateContext["params"]["id"], number>>,
  Expect<Equals<NativeContext["body"], CreateUser>>,
  Expect<Equals<NativeContext["params"], UserParams>>,
  Expect<Equals<EveryModelSlotContext["query"], UpdateUser>>,
  Expect<Equals<EveryModelSlotContext["headers"], UpdateUser>>,
  Expect<Equals<EveryModelSlotContext["cookie"]["displayName"]["value"], string>>,
];

function assertNativeModelStatus(status: ElysiaStatus<typeof nativeContextRouteSchema>): void {
  status(201, { id: 1, name: "Ada" });
  status(409, { code: "DUPLICATE_USER" });
  // @ts-expect-error Status 409 requires the declared duplicate-user response.
  status(409, { id: 1, name: "Ada" });
  // @ts-expect-error Status 404 is absent from the response contract.
  status(404, { code: "NOT_FOUND" });
}

test("keeps validation model route-input and context assertions referenced", () => {
  const assertions: ValidationModelTypeAssertions = [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ];

  expect(assertions).toEqual([true, true, true, true, true, true, true, true]);
  expect(assertNativeModelStatus).toBeFunction();
});
