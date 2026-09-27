import { expect, test } from "bun:test";
import {
  Body,
  Ctx,
  Param,
  Query,
  Res,
  Set,
  Status,
  Store,
  getRouteParameterMetadata,
} from "../src/index.ts";

class UserController {
  createUser(_body: unknown, _id: unknown): string {
    return "created";
  }

  readContext(_context: unknown): string {
    return "read";
  }

  readNativeParts(_store: unknown, _set: unknown, _status: unknown): string {
    return "native";
  }

  listUsers(): string {
    return "listed";
  }
}

Body()(UserController.prototype, "createUser", 0);
Param("id")(UserController.prototype, "createUser", 1);
Ctx()(UserController.prototype, "readContext", 0);
Store()(UserController.prototype, "readNativeParts", 0);
Set()(UserController.prototype, "readNativeParts", 1);
Status()(UserController.prototype, "readNativeParts", 2);

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

test("records native context parts and keeps Res as the Set alias", () => {
  expect(getRouteParameterMetadata(UserController, "readNativeParts")).toEqual([
    { index: 0, kind: "store", property: undefined },
    { index: 1, kind: "set", property: undefined },
    { index: 2, kind: "status", property: undefined },
  ]);
  expect(Res).toBe(Set);
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

class OutOfOrderController {
  read(_first: unknown, _second: unknown, _third: unknown): string {
    return "read";
  }

  other(_first: unknown): string {
    return "other";
  }
}

Param("third")(OutOfOrderController.prototype, "read", 2);
Body()(OutOfOrderController.prototype, "read", 0);

test("sorts parameters that were decorated out of order and isolates each method", () => {
  const parameters = getRouteParameterMetadata(OutOfOrderController, "read");
  const repeated = getRouteParameterMetadata(OutOfOrderController, "read");

  expect(parameters).toEqual([
    { index: 0, kind: "body", property: undefined },
    { index: 2, kind: "params", property: "third" },
  ]);
  expect(repeated).toEqual(parameters);
  expect(repeated).not.toBe(parameters);
  expect(getRouteParameterMetadata(OutOfOrderController, "other")).toEqual([]);

  class ChildOutOfOrderController extends OutOfOrderController {}

  expect(getRouteParameterMetadata(ChildOutOfOrderController, "read")).toEqual([]);
});
