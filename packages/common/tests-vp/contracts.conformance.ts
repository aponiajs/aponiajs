import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Controller,
  Inject,
  Module,
  Post,
  Set,
  Status,
  Store,
  createToken,
  defineModule,
  getConstructorDependencies,
  getControllerMetadata,
  getModuleMetadata,
  getRouteParameterMetadata,
  getRouteMetadata,
  isRouteResponseSchemaMap,
  isStandardSchema,
  provideValue,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("common contracts work in the Vite+ lane", () => {
  const value = createToken<number>("value");
  const module = defineModule({
    id: "common-conformance",
    providers: [provideValue(value, 1)],
    exports: [value],
  });

  expect(module.id).toBe("common-conformance");
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

  Store()(NativeContextController.prototype, "read", 0);
  Set()(NativeContextController.prototype, "read", 1);
  Status()(NativeContextController.prototype, "read", 2);

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
