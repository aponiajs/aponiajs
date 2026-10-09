import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  createToken,
  getConstructorDependencies,
  getControllerMetadata,
  getModuleMetadata,
  getRouteMetadata,
  provideValue,
} from "../src/index.ts";

describe("@aponiajs/common decorator metadata edges", () => {
  test("keeps @Injectable a no-op that records no metadata", () => {
    class PlainService {}

    Injectable()(PlainService);

    expect(getModuleMetadata(PlainService)).toBeUndefined();
    expect(getControllerMetadata(PlainService)).toBeUndefined();
    expect(getRouteMetadata(PlainService)).toEqual([]);
    expect(getConstructorDependencies(PlainService)).toEqual([]);
  });

  test("copies and freezes declared @Module metadata collections", () => {
    const value = createToken<number>("module-value");
    class ImportedModule {}
    class LateModule {}
    class DeclaredModule {}
    const imports = [ImportedModule];
    const providers = [provideValue(value, 1)];
    const controllers = [ImportedModule];

    Module({ imports, providers, controllers })(DeclaredModule);
    imports.push(LateModule);
    providers.push(provideValue(createToken<number>("late-value"), 2));
    controllers.push(LateModule);

    const metadata = getModuleMetadata(DeclaredModule);

    expect(metadata?.imports).toEqual([ImportedModule]);
    expect(metadata?.providers).toEqual([provideValue(value, 1)]);
    expect(metadata?.controllers).toEqual([ImportedModule]);
    expect(metadata?.exports).toEqual([]);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata?.imports)).toBe(true);
    expect(Object.isFrozen(metadata?.providers)).toBe(true);
    expect(Object.isFrozen(metadata?.controllers)).toBe(true);
    expect(Object.isFrozen(metadata?.exports)).toBe(true);
  });

  test("replaces controller metadata when a class is decorated twice", () => {
    class ReDecoratedController {}
    Controller("first")(ReDecoratedController);
    Controller("second")(ReDecoratedController);

    expect(getControllerMetadata(ReDecoratedController)).toEqual({ path: "second" });
    expect(Object.isFrozen(getControllerMetadata(ReDecoratedController))).toBe(true);
  });

  test("accumulates route metadata per method and returns a frozen copy", () => {
    class RouteController {
      handle(): string {
        return "handled";
      }
    }

    Get("/first")(
      RouteController.prototype,
      "handle",
      Object.getOwnPropertyDescriptor(RouteController.prototype, "handle")!,
    );
    Post("/second")(
      RouteController.prototype,
      "handle",
      Object.getOwnPropertyDescriptor(RouteController.prototype, "handle")!,
    );

    const routes = getRouteMetadata(RouteController);
    const repeated = getRouteMetadata(RouteController);

    expect(routes.map((route) => [route.method, route.path])).toEqual([
      ["GET", "/first"],
      ["POST", "/second"],
    ]);
    expect(routes.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(routes)).toBe(true);
    expect(repeated).toEqual(routes);
    expect(repeated).not.toBe(routes);

    class ChildRouteController extends RouteController {}

    expect(getRouteMetadata(ChildRouteController)).toEqual([]);
  });

  test("reports no constructor dependencies for an undecorated class", () => {
    class PlainConsumer {}
    const dependencies = getConstructorDependencies(PlainConsumer);

    expect(dependencies).toEqual([]);
    expect(Object.isFrozen(dependencies)).toBe(true);
  });

  test("accepts an explicit token at index zero without reflected parameter types", () => {
    class ExplicitConsumer {}
    const explicitDependency = createToken<string>("explicit-only");
    Inject(explicitDependency)(ExplicitConsumer, undefined, 0);

    expect(getConstructorDependencies(ExplicitConsumer)).toEqual([explicitDependency]);
  });

  test("reads reflected parameter types through the prototype chain for subclasses", () => {
    class ReflectedDependency {}
    class ParentConsumer {}
    class ChildConsumer extends ParentConsumer {}
    Reflect.defineMetadata("design:paramtypes", [ReflectedDependency], ParentConsumer);

    expect(getConstructorDependencies(ParentConsumer)).toEqual([ReflectedDependency]);
    expect(getConstructorDependencies(ChildConsumer)).toEqual([ReflectedDependency]);
  });
});
