import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  AponiaError,
  Validation,
  getValidationMetadata,
  resolveRouteValidator,
  type InferValidatorOutput,
  type RouteContext,
  type RouteSchema,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const schema: StandardSchemaV1<unknown, { value: string }> = {
  "~standard": {
    version: 1,
    vendor: "aponia-validation-conformance",
    validate: (value) => ({ value: value as { value: string } }),
  },
};

class ConformanceModel {
  declare readonly value: string;
}

Validation(schema)(ConformanceModel);

test("the Vite+ lane resolves immutable own validation metadata", () => {
  class ChildModel extends ConformanceModel {}

  const metadata = getValidationMetadata(ConformanceModel);

  expect(metadata?.validator).toBe(schema);
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(getValidationMetadata(ChildModel)).toBeUndefined();
  expect(resolveRouteValidator(ConformanceModel)).toBe(schema);
});

test("the Vite+ lane preserves callable Standard Schema validators", () => {
  const callableSchema: StandardSchemaV1<unknown, { value: string }> &
    ((value: unknown) => boolean) = Object.assign((_value: unknown): boolean => true, {
    "~standard": {
      version: 1 as const,
      vendor: "aponia-callable-validation-conformance",
      validate: (value: unknown) => ({ value: value as { value: string } }),
    },
  });

  expect(resolveRouteValidator(callableSchema)).toBe(callableSchema);
});

test("the Vite+ lane exposes structured invalid-model failures", () => {
  class UndecoratedModel {}

  try {
    resolveRouteValidator(UndecoratedModel);
    throw new Error("Expected the undecorated model to be rejected.");
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    if (!(error instanceof AponiaError)) {
      throw error;
    }

    expect(error.code).toBe("INVALID_VALIDATION_MODEL");
    expect(error.details).toEqual({ model: "UndecoratedModel" });
  }
});

const routeSchema = {
  body: ConformanceModel,
  response: {
    200: ConformanceModel,
  },
} satisfies RouteSchema;

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;
type ValidationConformanceAssertions = [
  Expect<Equals<InferValidatorOutput<typeof ConformanceModel>, ConformanceModel>>,
  Expect<Equals<RouteContext<typeof routeSchema>["body"], ConformanceModel>>,
];

test("the Vite+ lane keeps validation-model type assertions referenced", () => {
  const assertions: ValidationConformanceAssertions = [true, true];

  expect(assertions).toEqual([true, true]);
});
