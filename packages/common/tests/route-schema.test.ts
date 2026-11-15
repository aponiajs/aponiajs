import { expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as TypeBox from "typebox/type";
import {
  Get,
  Post,
  getRouteMetadata,
  isRouteResponseSchemaMap,
  isStandardSchema,
  routeSchemaSlots,
  type InferValidatorOutput,
  type RouteContext,
  type RouteResponseSchemaMap,
  type RouteSchema,
  type RouteValidator,
} from "../src/index.ts";

const nameSchema: StandardSchemaV1<unknown, { name: string }> = {
  "~standard": {
    version: 1,
    vendor: "aponia-test",
    validate: (value) =>
      typeof value === "object" && value !== null && "name" in value
        ? { value: value as { name: string } }
        : { issues: [{ message: "name is required" }] },
  },
};

/**
 * A real TypeBox schema, which is what the supported platform's `t` builder
 * constructs. The neutral contract has to recognize the value itself, so the
 * fixture is a built schema rather than an object shaped like one.
 */
const nativeObjectSchema = TypeBox.Object({
  name: TypeBox.String({ minLength: 1 }),
});

/** A codec decodes a wire value, so its slot value is the decoded one. */
const nativeDecodedSchema = TypeBox.Decode(TypeBox.String(), (value: string) => value.length);

const nativeRouteSchema = {
  body: nativeObjectSchema,
  response: { 201: nativeObjectSchema },
} satisfies RouteSchema;

/** The same built schema in every slot, so no slot escapes the native contract. */
const everyNativeSlotSchema = {
  body: nativeObjectSchema,
  query: nativeObjectSchema,
  params: nativeObjectSchema,
  headers: nativeObjectSchema,
  cookie: nativeObjectSchema,
  response: nativeObjectSchema,
} satisfies RouteSchema;

/** Every marker a TypeBox builder declares, including the modifier wrappers. */
const nativeSchemaVariants = [
  nativeObjectSchema,
  TypeBox.Optional(nativeObjectSchema),
  TypeBox.Unsafe<Date>({ type: "string" }),
] satisfies readonly RouteValidator[];

const bodySchema = { body: nameSchema };

class UserController {
  createUser(): string {
    return "created";
  }

  replaceUser(): string {
    return "replaced";
  }

  getHealth(): string {
    return "ok";
  }
}

function decorate(propertyKey: keyof UserController, apply: ReturnType<typeof Post>): void {
  apply(
    UserController.prototype,
    propertyKey,
    Object.getOwnPropertyDescriptor(UserController.prototype, propertyKey)!,
  );
}

decorate("createUser", Post("/", bodySchema));
decorate("replaceUser", Post(bodySchema));
decorate("getHealth", Get("health"));

const routes = getRouteMetadata(UserController);

test("records the schema declared beside a route path", () => {
  expect(routes[0]?.method).toBe("POST");
  expect(routes[0]?.path).toBe("/");
  expect(routes[0]?.schema?.body).toBe(nameSchema);
});

test("accepts a schema without a path", () => {
  expect(routes[1]?.path).toBe("");
  expect(routes[1]?.schema?.body).toBe(nameSchema);
});

test("leaves routes without a schema undefined", () => {
  expect(routes[2]?.path).toBe("health");
  expect(routes[2]?.schema).toBeUndefined();
});

test("freezes recorded route schemas", () => {
  expect(Object.isFrozen(routes[0]?.schema)).toBe(true);
});

test("detects Standard Schema validators", () => {
  expect(isStandardSchema(nameSchema)).toBe(true);
  expect(isStandardSchema(nativeObjectSchema)).toBe(false);
});

const responseSchemas: Record<number, typeof nameSchema> = {
  200: nameSchema,
  404: nameSchema,
};

class ResponseController {
  readUser(): string {
    return "read";
  }
}

Get({
  cookie: nameSchema,
  response: responseSchemas,
})(
  ResponseController.prototype,
  "readUser",
  Object.getOwnPropertyDescriptor(ResponseController.prototype, "readUser")!,
);

const [responseRoute] = getRouteMetadata(ResponseController);

test("records cookie and status-specific response schemas", () => {
  expect(routeSchemaSlots).toEqual(["body", "query", "params", "headers", "cookie", "response"]);
  expect(responseRoute?.schema?.cookie).toBe(nameSchema);
  expect(responseRoute?.schema?.response).toEqual({
    200: nameSchema,
    404: nameSchema,
  });
  expect(isRouteResponseSchemaMap(responseSchemas)).toBe(true);
  expect(isRouteResponseSchemaMap(nameSchema)).toBe(false);
  expect(isRouteResponseSchemaMap(nativeObjectSchema)).toBe(false);
});

test("copies and freezes a status-specific response schema map", () => {
  responseSchemas[500] = nameSchema;

  expect(responseRoute?.schema?.response).not.toHaveProperty("500");
  expect(Object.isFrozen(responseRoute?.schema?.response)).toBe(true);
});

test("treats only non-empty all-numeric response maps as status maps", () => {
  const mixedKeys = { 200: nameSchema, Not: nameSchema } as unknown as RouteResponseSchemaMap;
  const negativeStatus = { "-1": nameSchema } as unknown as RouteResponseSchemaMap;

  expect(isRouteResponseSchemaMap({})).toBe(false);
  expect(isRouteResponseSchemaMap(mixedKeys)).toBe(false);
  expect(isRouteResponseSchemaMap(negativeStatus)).toBe(false);
});

test("preserves a raw response validator instance and freezes the route schema", () => {
  class RawResponseController {
    readUser(): string {
      return "read";
    }
  }

  Get({ response: nameSchema })(
    RawResponseController.prototype,
    "readUser",
    Object.getOwnPropertyDescriptor(RawResponseController.prototype, "readUser")!,
  );

  const [route] = getRouteMetadata(RawResponseController);

  expect(route?.schema?.response).toBe(nameSchema);
  expect(isRouteResponseSchemaMap(nameSchema)).toBe(false);
  expect(Object.isFrozen(route?.schema)).toBe(true);
});

class NativeSchemaController {
  createUser(): string {
    return "created";
  }

  readUser(): string {
    return "read";
  }
}

Post(nativeRouteSchema)(
  NativeSchemaController.prototype,
  "createUser",
  Object.getOwnPropertyDescriptor(NativeSchemaController.prototype, "createUser")!,
);

Post(everyNativeSlotSchema)(
  NativeSchemaController.prototype,
  "readUser",
  Object.getOwnPropertyDescriptor(NativeSchemaController.prototype, "readUser")!,
);

test("records a built TypeBox schema in the slots it is declared in", () => {
  const [route] = getRouteMetadata(NativeSchemaController);

  expect(route?.schema?.body).toBe(nativeObjectSchema);
  expect(route?.schema?.response).toEqual({ 201: nativeObjectSchema });
  expect(Object.isFrozen(route?.schema)).toBe(true);
});

test("records a built TypeBox schema in every route schema slot", () => {
  const [, route] = getRouteMetadata(NativeSchemaController);

  expect(route?.schema?.body).toBe(nativeObjectSchema);
  expect(route?.schema?.query).toBe(nativeObjectSchema);
  expect(route?.schema?.params).toBe(nativeObjectSchema);
  expect(route?.schema?.headers).toBe(nativeObjectSchema);
  expect(route?.schema?.cookie).toBe(nativeObjectSchema);
  expect(route?.schema?.response).toBe(nativeObjectSchema);
});

test("recognizes a built TypeBox schema as a raw validator, not a status map", () => {
  expect(isStandardSchema(nativeObjectSchema)).toBe(false);
  expect(isRouteResponseSchemaMap(nativeObjectSchema)).toBe(false);
  expect(nativeSchemaVariants.every((variant) => isStandardSchema(variant) === false)).toBe(true);
});

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;
type CookieContext = RouteContext<{ cookie: typeof nameSchema }>;
type NativeRouteContext = RouteContext<typeof nativeRouteSchema>;
type EveryNativeSlotContext = RouteContext<typeof everyNativeSlotSchema>;
type RouteSchemaTypeAssertions = [
  Expect<Equals<CookieContext["cookie"]["name"]["value"], string>>,
  Expect<Equals<InferValidatorOutput<typeof nativeObjectSchema>, { name: string }>>,
  Expect<Equals<NativeRouteContext["body"], { name: string }>>,
  Expect<Equals<InferValidatorOutput<typeof nativeDecodedSchema>, number>>,
  Expect<Equals<EveryNativeSlotContext["body"], { name: string }>>,
  Expect<Equals<EveryNativeSlotContext["query"], { name: string }>>,
  Expect<Equals<EveryNativeSlotContext["params"], { name: string }>>,
  Expect<Equals<EveryNativeSlotContext["headers"], { name: string }>>,
  Expect<Equals<EveryNativeSlotContext["cookie"]["name"]["value"], string>>,
];

test("keeps route schema type assertions referenced", () => {
  const assertions: RouteSchemaTypeAssertions = [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ];

  expect(assertions).toEqual([true, true, true, true, true, true, true, true, true]);
});
