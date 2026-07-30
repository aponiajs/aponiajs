import { expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Get,
  Post,
  getRouteMetadata,
  isRouteResponseSchemaMap,
  isStandardSchema,
  routeSchemaSlots,
  type RouteContext,
} from "../src/index.ts";

const nameSchema: StandardSchemaV1<unknown, { name: string }> = {
  "~standard": {
    version: 1,
    vendor: "aponia-test",
    validate: (value) =>
      typeof value === "object" && value !== null && "name" in value
        ? { value: value as { name: string } }
        : { issues: [{ message: "name is required" }] },
  },
};

const bodySchema = { body: nameSchema };

class UserController {
  createUser(): string {
    return "created";
  }

  replaceUser(): string {
    return "replaced";
  }

  getHealth(): string {
    return "ok";
  }
}

function decorate(propertyKey: keyof UserController, apply: ReturnType<typeof Post>): void {
  apply(
    UserController.prototype,
    propertyKey,
    Object.getOwnPropertyDescriptor(UserController.prototype, propertyKey)!,
  );
}

decorate("createUser", Post("/", bodySchema));
decorate("replaceUser", Post(bodySchema));
decorate("getHealth", Get("health"));

const routes = getRouteMetadata(UserController);

test("records the schema declared beside a route path", () => {
  expect(routes[0]?.method).toBe("POST");
  expect(routes[0]?.path).toBe("/");
  expect(routes[0]?.schema?.body).toBe(nameSchema);
});

test("accepts a schema without a path", () => {
  expect(routes[1]?.path).toBe("");
  expect(routes[1]?.schema?.body).toBe(nameSchema);
});

test("leaves routes without a schema undefined", () => {
  expect(routes[2]?.path).toBe("health");
  expect(routes[2]?.schema).toBeUndefined();
});

test("freezes recorded route schemas", () => {
  expect(Object.isFrozen(routes[0]?.schema)).toBe(true);
});

test("detects Standard Schema validators", () => {
  expect(isStandardSchema(nameSchema)).toBe(true);
  expect(isStandardSchema({ static: 0, params: [] })).toBe(false);
});

const responseSchemas: Record<number, typeof nameSchema> = {
  200: nameSchema,
  404: nameSchema,
};

class ResponseController {
  readUser(): string {
    return "read";
  }
}

Get({
  cookie: nameSchema,
  response: responseSchemas,
})(
  ResponseController.prototype,
  "readUser",
  Object.getOwnPropertyDescriptor(ResponseController.prototype, "readUser")!,
);

const [responseRoute] = getRouteMetadata(ResponseController);

test("records cookie and status-specific response schemas", () => {
  expect(routeSchemaSlots).toEqual(["body", "query", "params", "headers", "cookie", "response"]);
  expect(responseRoute?.schema?.cookie).toBe(nameSchema);
  expect(responseRoute?.schema?.response).toEqual({
    200: nameSchema,
    404: nameSchema,
  });
  expect(isRouteResponseSchemaMap(responseSchemas)).toBe(true);
  expect(isRouteResponseSchemaMap(nameSchema)).toBe(false);
  expect(
    isRouteResponseSchemaMap({
      static: undefined,
      params: [],
    }),
  ).toBe(false);
});

test("copies and freezes a status-specific response schema map", () => {
  responseSchemas[500] = nameSchema;

  expect(responseRoute?.schema?.response).not.toHaveProperty("500");
  expect(Object.isFrozen(responseRoute?.schema?.response)).toBe(true);
});

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;
type CookieContext = RouteContext<{ cookie: typeof nameSchema }>;
type RouteSchemaTypeAssertions = [Expect<Equals<CookieContext["cookie"]["name"]["value"], string>>];

test("keeps route schema type assertions referenced", () => {
  const assertions: RouteSchemaTypeAssertions = [true];

  expect(assertions).toEqual([true]);
});
