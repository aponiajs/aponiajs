import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  intersectSchema,
  omitSchema,
  partialSchema,
  pickSchema,
  type RouteValidator,
} from "../src/index.ts";

const base = z.object({ name: z.string(), email: z.string() });

function validate(schema: RouteValidator, value: unknown): unknown {
  if (!("~standard" in schema)) {
    throw new Error("The derived schema is not a Standard Schema validator.");
  }
  return schema["~standard"].validate(value);
}

describe("schema combinators", () => {
  test("partialSchema makes every field optional", async () => {
    const partial = partialSchema(base);
    const result = (await validate(partial, {})) as { readonly issues?: unknown };

    expect(result.issues).toBeUndefined();
  });

  test("pickSchema keeps only the named fields", async () => {
    const picked = pickSchema(base, ["name"]);
    const result = (await validate(picked, { name: "ada", email: "ada@example.com" })) as {
      readonly value?: unknown;
    };

    expect(result.value).toEqual({ name: "ada" });
  });

  test("omitSchema removes the named fields", async () => {
    const omitted = omitSchema(base, ["email"]);
    const result = (await validate(omitted, { name: "ada", email: "ada@example.com" })) as {
      readonly value?: unknown;
    };

    expect(result.value).toEqual({ name: "ada" });
  });

  test("intersectSchema carries both shapes", async () => {
    const left = z.object({ name: z.string() });
    const right = z.object({ age: z.number() });
    const combined = intersectSchema(left, right);
    const result = (await validate(combined, { name: "ada", age: 36 })) as {
      readonly value?: unknown;
    };

    expect(result.value).toEqual({ name: "ada", age: 36 });
  });

  test("refuses a Standard Schema validator without the operation", () => {
    const standardOnly = Object.freeze({
      "~standard": Object.freeze({
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      }),
    });

    expect(() => partialSchema(standardOnly as unknown as RouteValidator)).toThrow(
      expect.objectContaining({ code: "INVALID_VALIDATION_MODEL" }),
    );
    expect(() => omitSchema(standardOnly as unknown as RouteValidator, ["a"])).toThrow(
      expect.objectContaining({ code: "INVALID_VALIDATION_MODEL" }),
    );
    expect(() => intersectSchema(leftOf(standardOnly), rightOf(standardOnly))).toThrow(
      expect.objectContaining({ code: "INVALID_VALIDATION_MODEL" }),
    );
  });

  test("intersectSchema falls back to merge", () => {
    const standard = Object.freeze({
      "~standard": Object.freeze({
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      }),
    });
    const right = standard as unknown as RouteValidator;
    const left = {
      ...standard,
      merge: (other: unknown) => ({ merged: other }),
    } as unknown as RouteValidator;

    const result = intersectSchema(left, right) as unknown as {
      readonly merged: unknown;
    };

    expect(result.merged).toBe(right);
  });

  test("refuses a value that is not a Standard Schema validator", () => {
    expect(() => pickSchema({} as unknown as RouteValidator, ["a"])).toThrow(
      expect.objectContaining({ code: "INVALID_VALIDATION_MODEL" }),
    );
  });
});

function leftOf(value: unknown): RouteValidator {
  return value as RouteValidator;
}

function rightOf(value: unknown): RouteValidator {
  return value as RouteValidator;
}
