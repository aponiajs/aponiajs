import { expect, test } from "bun:test";
import { Body, Ctx, Param, Query, getRouteParameterMetadata } from "../src/index.ts";

class UserController {
  createUser(_body: unknown, _id: unknown): string {
    return "created";
  }

  readContext(_context: unknown): string {
    return "read";
  }

  listUsers(): string {
    return "listed";
  }
}

Body()(UserController.prototype, "createUser", 0);
Param("id")(UserController.prototype, "createUser", 1);
Ctx()(UserController.prototype, "readContext", 0);

test("records decorated parameters in positional order", () => {
  expect(getRouteParameterMetadata(UserController, "createUser")).toEqual([
    { index: 0, kind: "body", property: undefined },
    { index: 1, kind: "params", property: "id" },
  ]);
});

test("records the parameter kind for each decorator", () => {
  expect(getRouteParameterMetadata(UserController, "readContext")).toEqual([
    { index: 0, kind: "context", property: undefined },
  ]);
});

test("reports no parameters for an undecorated handler", () => {
  expect(getRouteParameterMetadata(UserController, "listUsers")).toEqual([]);
});

test("keeps recorded parameters frozen", () => {
  const parameters = getRouteParameterMetadata(UserController, "createUser");

  expect(Object.isFrozen(parameters)).toBe(true);
  expect(Object.isFrozen(parameters[0])).toBe(true);
});

test("rejects a decorator applied outside a method parameter", () => {
  expect(() => Query()(UserController.prototype, undefined, 0)).toThrow(
    "can only decorate a route handler parameter",
  );
});
