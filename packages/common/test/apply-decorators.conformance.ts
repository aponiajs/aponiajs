import { Controller, Get, SetMetadata, applyDecorators, getRouteMetadata } from "@aponiajs/common";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("applyDecorators composes method decorators in declaration order", () => {
  const applied: string[] = [];

  const mark =
    (name: string): MethodDecorator =>
    (_target, key) => {
      applied.push(name);
      expect(key).toBe("run");
    };

  class Example {
    @applyDecorators(mark("first"), mark("second"))
    run(): void {}
  }

  expect(applied).toEqual(["first", "second"]);
  expect(new Example()).toBeInstanceOf(Example);
});

test("applyDecorators composes a property decorator", () => {
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

test("applyDecorators composes a route decorator with metadata", () => {
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
