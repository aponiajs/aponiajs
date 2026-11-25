import { expect, test } from "bun:test";
import { Controller, Get, SetMetadata, applyDecorators, getRouteMetadata } from "../index.ts";

test("applies composed method decorators in declaration order", () => {
  const applied: string[] = [];

  const mark =
    (name: string): MethodDecorator =>
    (_target, key, descriptor) => {
      applied.push(name);
      expect(key).toBe("run");
      expect(typeof descriptor?.value).toBe("function");
    };

  class Example {
    @applyDecorators(mark("first"), mark("second"))
    run(): void {}
  }

  expect(applied).toEqual(["first", "second"]);
  expect(new Example()).toBeInstanceOf(Example);
});

test("applies composed class decorators to the class itself", () => {
  const applied: string[] = [];

  const mark =
    (name: string): ClassDecorator =>
    () => {
      applied.push(name);
    };

  @applyDecorators(mark("one"), mark("two"))
  class Example {}

  expect(applied).toEqual(["one", "two"]);
  expect(Example.name).toBe("Example");
});

test("applies a composed property decorator to the field", () => {
  const applied: string[] = [];

  const mark =
    (name: string): PropertyDecorator =>
    (_target, key) => {
      applied.push(`${name}:${String(key)}`);
    };

  class Example {
    @applyDecorators(mark("field"))
    value = 1;
  }

  expect(applied).toEqual(["field:value"]);
  expect(new Example().value).toBe(1);
});

test("composes a route decorator with metadata on one handler", () => {
  const Roles = (roles: readonly string[]) => SetMetadata("roles", roles);

  @Controller("applied")
  class AppliedController {
    @applyDecorators(Get("daily"), Roles(["admin"]))
    daily(): string {
      return "ok";
    }
  }

  const routes = getRouteMetadata(AppliedController);
  expect(routes).toHaveLength(1);
  expect(routes[0]?.propertyKey).toBe("daily");
  expect(
    Reflect.getMetadata(
      Symbol.for("aponia.custom.metadata:roles"),
      Object.getOwnPropertyDescriptor(AppliedController.prototype, "daily")?.value,
    ),
  ).toEqual(["admin"]);
});
