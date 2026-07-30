import { expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  AponiaError,
  Post,
  Validation,
  getRouteMetadata,
  getValidationMetadata,
  resolveRouteValidator,
  type InferValidatorOutput,
  type NativeSchema,
  type RouteContext,
  type RouteSchema,
  type RouteValidator,
} from "../src/index.ts";

const nameSchema: StandardSchemaV1<unknown, { name: string }> = {
  "~standard": {
    version: 1,
    vendor: "aponia-validation-test",
    validate: (value) => ({ value: value as { name: string } }),
  },
};

const nativeSchema = {
  static: { id: "" },
  params: [],
} satisfies NativeSchema;

const callableNameSchema: StandardSchemaV1<unknown, { name: string }> &
  ((value: unknown) => boolean) = Object.assign(
  (value: unknown): boolean => typeof value === "object" && value !== null,
  {
    "~standard": {
      version: 1 as const,
      vendor: "aponia-callable-validation-test",
      validate: (value: unknown) => ({ value: value as { name: string } }),
    },
  },
);

class CreateUser {
  declare readonly name: string;
}

Validation(nameSchema)(CreateUser);

test("records one immutable validator metadata entry on its declaring class", () => {
  class ChildCreateUser extends CreateUser {}

  const metadata = getValidationMetadata(CreateUser);

  expect(metadata?.validator).toBe(nameSchema);
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(getValidationMetadata(ChildCreateUser)).toBeUndefined();
});

test("resolves validation models and preserves raw validator instances", () => {
  expect(resolveRouteValidator(CreateUser)).toBe(nameSchema);
  expect(resolveRouteValidator(nameSchema)).toBe(nameSchema);
  expect(resolveRouteValidator(nativeSchema)).toBe(nativeSchema);
});

test("checks callable Standard Schema validators before constructor resolution", () => {
  expect(resolveRouteValidator(callableNameSchema)).toBe(callableNameSchema);
});

test("rejects undecorated classes with a structured immutable framework error", () => {
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
    expect(Object.isFrozen(error.details)).toBe(true);
  }
});

const modelRouteSchema = {
  body: CreateUser,
  query: CreateUser,
  params: CreateUser,
  headers: CreateUser,
  cookie: CreateUser,
  response: {
    201: CreateUser,
    400: nameSchema,
  },
} satisfies RouteSchema;

class ValidationController {
  create(): string {
    return "created";
  }
}

Post(modelRouteSchema)(
  ValidationController.prototype,
  "create",
  Object.getOwnPropertyDescriptor(ValidationController.prototype, "create")!,
);

test("records validation-model classes in every route schema slot", () => {
  const [route] = getRouteMetadata(ValidationController);

  expect(route?.schema?.body).toBe(CreateUser);
  expect(route?.schema?.query).toBe(CreateUser);
  expect(route?.schema?.params).toBe(CreateUser);
  expect(route?.schema?.headers).toBe(CreateUser);
  expect(route?.schema?.cookie).toBe(CreateUser);
  expect(route?.schema?.response).toEqual({
    201: CreateUser,
    400: nameSchema,
  });
  expect(Object.isFrozen(route?.schema?.response)).toBe(true);
});

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;
type ModelContext = RouteContext<typeof modelRouteSchema>;
type ValidationTypeAssertions = [
  Expect<Equals<Parameters<typeof Validation>, [validator: RouteValidator]>>,
  Expect<Equals<InferValidatorOutput<typeof CreateUser>, CreateUser>>,
  Expect<Equals<ModelContext["body"], CreateUser>>,
  Expect<Equals<InferValidatorOutput<typeof callableNameSchema>, { name: string }>>,
];

test("keeps validation-model declaration type assertions referenced", () => {
  const assertions: ValidationTypeAssertions = [true, true, true, true];

  expect(assertions).toEqual([true, true, true, true]);
});

test("shares validation metadata across separate common package instances", async () => {
  type ValidationModule = typeof import("../src/routing/validation.ts");

  const validationUrl = new URL("../src/routing/validation.ts", import.meta.url);
  const first = (await import(`${validationUrl.href}?instance=first`)) as ValidationModule;
  const second = (await import(`${validationUrl.href}?instance=second`)) as ValidationModule;

  class SharedValidationModel {}

  first.Validation(nameSchema)(SharedValidationModel);

  expect(second.getValidationMetadata(SharedValidationModel)?.validator).toBe(nameSchema);
});
