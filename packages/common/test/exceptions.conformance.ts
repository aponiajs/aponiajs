import {
  ClassSerializerInterceptor,
  HttpException,
  HttpStatus,
  HttpVersionNotSupportedException,
  IntrinsicException,
  MisdirectedException,
  NotFoundException,
  Scope,
  StandardSchemaValidationPipe,
  StreamableFile,
  VERSION_NEUTRAL,
  ValidationPipe,
  VersioningType,
  type ArgumentMetadata,
  type LegacyProviderScope,
  type ProviderScope,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const body: ArgumentMetadata = { type: "body" };

test("HttpStatus is both the numeric set and the parameter decorator", () => {
  expect(HttpStatus.CREATED).toBe(201);
  expect(HttpStatus.NOT_FOUND).toBe(404);
  expect(typeof HttpStatus).toBe("function");
});

test("the exception surface answers its own status", async () => {
  const failure = new NotFoundException("missing");
  expect(failure.getStatus()).toBe(404);
  expect(failure.toResponse().status).toBe(404);
  expect(new HttpException("bad", 400).status).toBe(400);
  expect(new IntrinsicException("framework").name).toBe("IntrinsicException");
});

test("the newer built-ins carry their own status", () => {
  const misdirected = new MisdirectedException("wrong host");
  expect(misdirected.getStatus()).toBe(421);
  expect(misdirected.toResponse().status).toBe(421);
  expect(misdirected.name).toBe("MisdirectedException");

  const unsupported = new HttpVersionNotSupportedException("HTTP/3");
  expect(unsupported.getStatus()).toBe(505);
  expect(unsupported.toResponse().status).toBe(505);
  expect(unsupported.name).toBe("HttpVersionNotSupportedException");
});

test("the pipes accept a valid body and refuse an invalid one", async () => {
  const schema = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) =>
        typeof value === "object" && value !== null ? { value } : { issues: [{ message: "no" }] },
    },
  };
  const pipe = new StandardSchemaValidationPipe(schema as never);
  expect(await pipe.transform({ name: "a" }, body)).toEqual({ name: "a" });

  const validation = new ValidationPipe();
  expect(await validation.transform("x", { type: "param", metatype: String })).toBe("x");
});

test("the serializer and StreamableFile keep their contract", () => {
  expect(VersioningType.CUSTOM).toBe("custom");
  expect(VERSION_NEUTRAL).toBeDefined();
  const file = new StreamableFile(new Uint8Array([1]));
  expect(file.getHeaders()["content-type"]).toBe("application/octet-stream");
  expect(new ClassSerializerInterceptor()).toBeDefined();
});

test("Scope carries Nest's numeric values and accepts the legacy strings", () => {
  expect(Scope.DEFAULT).toBe(0);
  expect(Scope.TRANSIENT).toBe(1);
  expect(Scope.REQUEST).toBe(2);
  const numeric: ProviderScope = Scope.REQUEST;
  const legacy: LegacyProviderScope = "request";
  expect(numeric).toBe(2);
  expect(legacy).toBe("request");
});
