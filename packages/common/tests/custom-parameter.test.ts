import { expect, test } from "bun:test";
import { createParamDecorator } from "../src/routing/custom-parameter.ts";
import { getRouteParameterMetadata } from "../src/routing/route-parameters.ts";

class UpperPipe {
  transform(value: unknown): unknown {
    return value;
  }
}

test("records data, a leading pipe, and trailing pipes", () => {
  const User = createParamDecorator((data: string | undefined) => data ?? "user");
  class Controller {
    read(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, "read")!;
  expect(descriptor).toBeDefined();

  User(UpperPipe)(Controller.prototype, "read", 0);
  User("email")(Controller.prototype, "read", 1);
  User(new UpperPipe())(Controller.prototype, "read", 2);

  expect(getRouteParameterMetadata(Controller, "read")).toHaveLength(3);
});

test("refuses a custom parameter decorator outside a method parameter", () => {
  const User = createParamDecorator(() => "user");
  expect(() => (User() as unknown as (target: object) => void)({})).toThrow(TypeError);
});
