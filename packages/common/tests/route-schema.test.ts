import { expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Get, Post, getRouteMetadata, isStandardSchema } from "../src/index.ts";

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
