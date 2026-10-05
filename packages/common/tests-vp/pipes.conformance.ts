import {
  DefaultValuePipe,
  ParseBoolPipe,
  ParseFloatPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  type ArgumentMetadata,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("the Vite+ lane transforms parameters using ParseIntPipe and ParseFloatPipe", () => {
  const intPipe = new ParseIntPipe();
  const floatPipe = new ParseFloatPipe();
  const metadata: ArgumentMetadata = { type: "param", data: "id" };

  expect(intPipe.transform("123", metadata)).toBe(123);
  expect(floatPipe.transform("123.45", metadata)).toBe(123.45);
});

test("the Vite+ lane transforms boolean parameters using ParseBoolPipe", () => {
  const boolPipe = new ParseBoolPipe();
  const metadata: ArgumentMetadata = { type: "query", data: "active" };

  expect(boolPipe.transform("true", metadata)).toBe(true);
  expect(boolPipe.transform("false", metadata)).toBe(false);
});

test("the Vite+ lane validates UUID parameters using ParseUUIDPipe", () => {
  const uuidPipe = new ParseUUIDPipe();
  const metadata: ArgumentMetadata = { type: "param", data: "uuid" };
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  expect(uuidPipe.transform(validUuid, metadata)).toBe(validUuid);
  expect(() => uuidPipe.transform("invalid-uuid", metadata)).toThrow();
});

test("the Vite+ lane applies fallback defaults using DefaultValuePipe", () => {
  const defaultPipe = new DefaultValuePipe("fallback");

  expect(defaultPipe.transform(undefined)).toBe("fallback");
  expect(defaultPipe.transform(null)).toBe("fallback");
  expect(defaultPipe.transform("custom")).toBe("custom");
});
