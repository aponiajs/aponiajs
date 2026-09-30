import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  Module,
  Param,
  Post,
  ResponseSettings,
  State,
  createToken,
  defineModule,
  formatLogValue,
  getConstructorDependencies,
  getControllerMetadata,
  getModuleMetadata,
  getRouteParameterMetadata,
  getRouteMetadata,
  isRouteResponseSchemaMap,
  isStandardSchema,
  provideClass,
  provideValue,
  type ClassProvider,
  type RouteParameterMetadata,
} from "../src/index.ts";
import type { ResponseSettingsState } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * `redirect` is asserted absent on purpose: the supported platform ignores an
 * assigned redirect, so the response settings type must not offer one.
 */
type ResponseSettingsAssertions = [
  Expect<Equals<"redirect" extends keyof ResponseSettingsState ? true : false, false>>,
  Expect<Equals<ResponseSettingsState["status"], number | string | undefined>>,
  Expect<
    Equals<ResponseSettingsState["headers"], Record<string, string | number | string[] | undefined>>
  >,
];

test("common contracts work in the Vite+ lane", () => {
  const value = createToken<number>("value");
  const module = defineModule({
    id: "common-conformance",
    providers: [provideValue(value, 1)],
    exports: [value],
  });

  expect(module.id).toBe("common-conformance");
});

test("the Vite+ lane binds a class provider to a separate token", () => {
  class Port {
    read(): string {
      return "port";
    }
  }
  class Impl implements Port {
    read(): string {
      return "impl";
    }
  }
  const token = createToken<Port>("bound-token");

  const bound: ClassProvider<Port, readonly []> = provideClass(token, Impl, [] as const);
  const own: ClassProvider<Impl, readonly []> = provideClass(Impl, [] as const);

  expect(bound.provide).toBe(token);
  expect(bound.useClass).toBe(Impl);
  expect(bound.inject).toEqual([]);
  expect(own.provide).toBe(Impl);
});

test("the Vite+ lane preserves exact module collection tuples", () => {
  const first = defineModule({ id: "first-conformance" });
  const second = defineModule({ id: "second-conformance" });
  const module = defineModule({
    id: "root-conformance",
    imports: [first, second],
  });
  const exactImports: readonly [typeof first, typeof second] = module.imports;

  expect(exactImports).toEqual([first, second]);
});

test("the Vite+ lane records route schemas declared on decorators", () => {
  const nameSchema: StandardSchemaV1<unknown, { name: string }> = {
    "~standard": {
      version: 1,
      vendor: "aponia-conformance",
      validate: (value) => ({ value: value as { name: string } }),
    },
  };

  class ConformanceController {
    createUser(): string {
      return "created";
    }
  }

  Post("/", {
    body: nameSchema,
    cookie: nameSchema,
    response: {
      200: nameSchema,
      404: nameSchema,
    },
  })(
    ConformanceController.prototype,
    "createUser",
    Object.getOwnPropertyDescriptor(ConformanceController.prototype, "createUser")!,
  );

  const [route] = getRouteMetadata(ConformanceController);

  expect(route?.method).toBe("POST");
  expect(route?.schema?.body).toBe(nameSchema);
  expect(route?.schema?.cookie).toBe(nameSchema);
  const response = route?.schema?.response;
  expect(response).toBeDefined();
  expect(response ? isRouteResponseSchemaMap(response) : false).toBe(true);
  expect(isStandardSchema(nameSchema)).toBe(true);
});

test("the Vite+ lane records native context parameter decorators", () => {
  class NativeContextController {
    read(_store: unknown, _set: unknown, _status: unknown): string {
      return "ok";
    }
  }

  State()(NativeContextController.prototype, "read", 0);
  ResponseSettings()(NativeContextController.prototype, "read", 1);
  HttpStatus()(NativeContextController.prototype, "read", 2);

  expect(getRouteParameterMetadata(NativeContextController, "read")).toEqual([
    { index: 0, kind: "store", property: undefined },
    { index: 1, kind: "set", property: undefined },
    { index: 2, kind: "status", property: undefined },
  ]);
});

test("the Vite+ lane preserves explicit dependencies and own decorator metadata", () => {
  class ReflectedDependency {}
  class Consumer {}
  const explicitDependency = createToken<string>("explicit-dependency");
  Reflect.defineMetadata("design:paramtypes", [ReflectedDependency, ReflectedDependency], Consumer);
  Inject(explicitDependency)(Consumer, undefined, 1);

  class ParentModule {}
  class ChildModule extends ParentModule {}
  class ParentController {}
  class ChildController extends ParentController {}
  Module({})(ParentModule);
  Controller("parent")(ParentController);

  expect(getConstructorDependencies(Consumer)).toEqual([ReflectedDependency, explicitDependency]);
  expect(getModuleMetadata(ParentModule)).toBeDefined();
  expect(getModuleMetadata(ChildModule)).toBeUndefined();
  expect(getControllerMetadata(ParentController)?.path).toBe("parent");
  expect(getControllerMetadata(ChildController)).toBeUndefined();
});

test("the Vite+ lane orders recorded parameters and keeps them out of subclasses", () => {
  class OrderedController {
    read(_first: unknown, _second: unknown): string {
      return "read";
    }
  }

  Param("second")(OrderedController.prototype, "read", 1);
  Body()(OrderedController.prototype, "read", 0);

  const parameters: readonly RouteParameterMetadata[] = getRouteParameterMetadata(
    OrderedController,
    "read",
  );

  expect(parameters).toEqual([
    { index: 0, kind: "body", property: undefined },
    { index: 1, kind: "params", property: "second" },
  ]);

  class ChildOrderedController extends OrderedController {}

  expect(getRouteParameterMetadata(ChildOrderedController, "read")).toEqual([]);
});

test("the Vite+ lane inherits explicit injection tokens through constructor-less subclasses", () => {
  class ParentConsumer {
    constructor(_dependency: string) {}
  }
  class ChildConsumer extends ParentConsumer {}
  class GrandChildConsumer extends ChildConsumer {}
  const explicitDependency = createToken<string>("inherited-dependency");
  Reflect.defineMetadata("design:paramtypes", [String], ParentConsumer);
  Inject(explicitDependency)(ParentConsumer, undefined, 0);

  expect(getConstructorDependencies(ParentConsumer)).toEqual([explicitDependency]);
  expect(getConstructorDependencies(ChildConsumer)).toEqual([explicitDependency]);
  expect(getConstructorDependencies(GrandChildConsumer)).toEqual([explicitDependency]);
});

test("the Vite+ lane keeps an overriding subclass's own injection tokens", () => {
  class ParentConsumer {
    constructor(_dependency: string) {}
  }
  class ChildConsumer extends ParentConsumer {
    constructor(_dependency: string) {
      super(_dependency);
    }
  }
  const parentDependency = createToken<string>("parent-dependency");
  const childDependency = createToken<string>("child-dependency");
  Reflect.defineMetadata("design:paramtypes", [String], ParentConsumer);
  Inject(parentDependency)(ParentConsumer, undefined, 0);
  Reflect.defineMetadata("design:paramtypes", [String], ChildConsumer);
  Inject(childDependency)(ChildConsumer, undefined, 0);

  expect(getConstructorDependencies(ChildConsumer)).toEqual([childDependency]);
});

test("the Vite+ lane keeps the response settings free of a redirect field", () => {
  const settings: ResponseSettingsState = { headers: {} };
  settings.status = "No Content";
  settings.headers["x-source"] = "conformance";
  const assertions = Array.from({ length: 3 }, () => true) as ResponseSettingsAssertions;

  expect(settings.status).toBe("No Content");
  expect(settings.headers).toEqual({ "x-source": "conformance" });
  expect(assertions).toHaveLength(3);
});

test("the Vite+ lane renders a logged value and never throws", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  Object.defineProperty(cyclic, Symbol.toPrimitive, {
    value: () => {
      throw new TypeError("this value cannot be stated");
    },
  });

  expect(formatLogValue({ ready: true })).toBe('{"ready":true}');
  expect(formatLogValue(cyclic)).toBe("[unrenderable]");
});
