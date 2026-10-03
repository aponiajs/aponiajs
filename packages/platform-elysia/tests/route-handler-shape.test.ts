import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

class RouteHandler {}

@Controller("class-handler")
class ClassHandlerController {
  handler = RouteHandler;
}

// A class is the only callable whose source Bun reports without a parameter
// list. TypeScript rejects a method decorator on a field, so the public
// decorator is applied directly, the way packages/common applies decorators in
// its own tests.
Get("route")(ClassHandlerController.prototype, "handler", {
  configurable: true,
  enumerable: true,
  writable: true,
});

@Module({ controllers: [ClassHandlerController] })
class ClassHandlerModule {}

test("rejects a class-valued route handler while mounting", async () => {
  const error = await AponiaFactory.create(ClassHandlerModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  // A class passes a `typeof handler === "function"` check and then throws when
  // called without `new`, which used to surface as a 500 carrying the raw engine
  // message on every request. The failure belongs at mount instead.
  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
      details: expect.objectContaining({ handler: "handler" }),
    }),
  );
});
