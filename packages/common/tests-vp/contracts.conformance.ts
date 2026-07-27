import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Post,
  createToken,
  defineModule,
  getRouteMetadata,
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

  Post("/", { body: nameSchema })(
    ConformanceController.prototype,
    "createUser",
    Object.getOwnPropertyDescriptor(ConformanceController.prototype, "createUser")!,
  );

  const [route] = getRouteMetadata(ConformanceController);

  expect(route?.method).toBe("POST");
  expect(route?.schema?.body).toBe(nameSchema);
  expect(isStandardSchema(nameSchema)).toBe(true);
});
