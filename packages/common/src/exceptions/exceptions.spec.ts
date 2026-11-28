import { describe, expect, test } from "bun:test";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  HttpVersionNotSupportedException,
  ImATeapotException,
  InternalServerErrorException,
  MethodNotAllowedException,
  MisdirectedException,
  NotAcceptableException,
  NotImplementedException,
  normalizeProviderScope,
  PayloadTooLargeException,
  PreconditionFailedException,
  RequestTimeoutException,
  ServiceUnavailableException,
  TooManyRequestsException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  ClassSerializerInterceptor,
  HttpException,
  HttpStatus,
  IntrinsicException,
  NotFoundException,
  SerializeOptions,
  StandardSchemaValidationPipe,
  StreamableFile,
  Validation,
  ValidationPipe,
  type ArgumentMetadata,
  type ExecutionContext,
  type ValidationError,
} from "../index.ts";

const schema = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) =>
      typeof value === "object" && value !== null && "name" in value
        ? { value }
        : { issues: [{ message: "is required", path: [{ key: "name" }] }] },
  },
};

@Validation(schema as never)
class CreateUser {}

describe("the exception surface", () => {
  test("HttpStatus carries Nest's numeric values and stays a decorator", () => {
    expect(HttpStatus.CREATED).toBe(201);
    expect(HttpStatus.NOT_FOUND).toBe(404);
    expect(typeof HttpStatus).toBe("function");

    class Controller {
      read(): void {}
    }
    HttpStatus()(Controller.prototype, "read", 0);
  });

  test("HttpException exposes its response and status", () => {
    const failure = new HttpException("nope", 418, { cause: "teapot" });
    expect(failure.getStatus()).toBe(418);
    expect(failure.status).toBe(418);
    expect(failure.getResponse()).toBe("nope");
    expect(failure.message).toBe("nope");
    expect(failure.name).toBe("HttpException");
    expect((failure as { cause?: unknown }).cause).toBe("teapot");
    expect(failure.toResponse().status).toBe(418);

    const objectFailure = new HttpException({ detail: "object" }, 409);
    expect(objectFailure.toResponse().status).toBe(409);
  });

  test("built-in exceptions carry their status and body", () => {
    const failure = new NotFoundException("User");
    expect(failure.getStatus()).toBe(404);
    expect(failure.message).toBe("User");
    expect(failure.name).toBe("NotFoundException");
    expect(new BadRequestException({ message: "invalid" }).message).toBe("invalid");
  });

  test("IntrinsicException is a distinct framework failure", () => {
    const failure = new IntrinsicException("framework");
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe("IntrinsicException");
  });
});

describe("the validation pipes", () => {
  const body: ArgumentMetadata = { type: "body", metatype: CreateUser };

  test("ValidationPipe accepts a valid body", async () => {
    const pipe = new ValidationPipe({ transform: true });
    const value = await pipe.transform({ name: "aponia" }, body);
    expect(value).toEqual({ name: "aponia" });
  });

  test("ValidationPipe refuses an invalid body with a 400", async () => {
    const pipe = new ValidationPipe();
    const failure = await pipe.transform({}, body).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect((failure as BadRequestException).getStatus()).toBe(400);
  });

  test("ValidationPipe leaves primitives and custom parameters alone", async () => {
    const pipe = new ValidationPipe();
    expect(await pipe.transform("value", { type: "param", metatype: String })).toBe("value");
    expect(await pipe.transform("value", { type: "custom" })).toBe("value");
    class PlainDto {}
    expect(await pipe.transform({ name: "a" }, { type: "body", metatype: PlainDto })).toEqual({
      name: "a",
    });
  });

  test("ValidationPipe shapes grouped and disabled messages", async () => {
    const grouped = new ValidationPipe({ errorFormat: "grouped" });
    const groupedFailure = await grouped.transform({}, body).catch((error: unknown) => error);
    expect((groupedFailure as BadRequestException).getResponse()).toMatchObject({
      message: { name: "is required" },
    });

    const disabled = new ValidationPipe({ disableErrorMessages: true });
    const disabledFailure = await disabled.transform({}, body).catch((error: unknown) => error);
    expect((disabledFailure as BadRequestException).getResponse()).toMatchObject({
      message: ["Bad Request"],
    });
  });

  test("ValidationPipe uses the caller's exception factory", async () => {
    const pipe = new ValidationPipe({
      exceptionFactory: (errors: readonly ValidationError[]) => new Error(errors[0]?.property),
    });
    const failure = await pipe.transform({}, body).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("name");
  });

  test("StandardSchemaValidationPipe validates with the stated schema", async () => {
    const pipe = new StandardSchemaValidationPipe(schema as never, { transform: true });
    expect(await pipe.transform({ name: "aponia" }, body)).toEqual({ name: "aponia" });
    const failure = await pipe.transform({}, body).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
  });
});

describe("serialization", () => {
  test("ClassSerializerInterceptor drops excluded prefixes", () => {
    @SerializeOptions({ excludePrefixes: ["secret"] })
    class Controller {
      read(): void {}
    }
    const interceptor = new ClassSerializerInterceptor();
    const handler = function read(): void {};
    const context = {
      getClass: () => Controller,
      getHandler: () => handler,
    } as unknown as ExecutionContext;

    expect(interceptor.interceptAfter(context, { name: "a", secretToken: "b" })).toEqual({
      name: "a",
    });
  });

  test("ClassSerializerInterceptor leaves a StreamableFile untouched", () => {
    const file = new StreamableFile(new Uint8Array([1, 2, 3]));
    const interceptor = new ClassSerializerInterceptor();
    const context = {
      getClass: () => class {},
      getHandler: () => () => undefined,
    } as unknown as ExecutionContext;
    expect(interceptor.interceptAfter(context, file)).toBe(file);
  });

  test("StreamableFile states its headers and stream", async () => {
    const file = new StreamableFile(new Uint8Array([1, 2, 3]), {
      type: "text/plain",
      disposition: "attachment; filename=a.txt",
      length: 3,
    });
    expect(file.getHeaders()).toEqual({
      "content-type": "text/plain",
      "content-disposition": "attachment; filename=a.txt",
      "content-length": "3",
    });
    const reader = file.getStream().getReader();
    const first = await reader.read();
    expect(first.value).toEqual(new Uint8Array([1, 2, 3]));
  });
});

test("every built-in exception states its own status", () => {
  const cases = [
    [BadGatewayException, 502],
    [BadRequestException, 400],
    [ConflictException, 409],
    [ForbiddenException, 403],
    [GatewayTimeoutException, 504],
    [GoneException, 410],
    [HttpVersionNotSupportedException, 505],
    [ImATeapotException, 418],
    [InternalServerErrorException, 500],
    [MethodNotAllowedException, 405],
    [MisdirectedException, 421],
    [NotAcceptableException, 406],
    [NotFoundException, 404],
    [NotImplementedException, 501],
    [PayloadTooLargeException, 413],
    [PreconditionFailedException, 412],
    [RequestTimeoutException, 408],
    [ServiceUnavailableException, 503],
    [TooManyRequestsException, 429],
    [UnauthorizedException, 401],
    [UnprocessableEntityException, 422],
    [UnsupportedMediaTypeException, 415],
  ] as const;

  for (const [ExceptionClass, status] of cases) {
    const failure = new ExceptionClass("body", "description");
    expect(failure.getStatus()).toBe(status);
    expect(failure.message).toBe("body: description");
    expect(failure.name).toBe(ExceptionClass.name);
  }

  expect(new BadRequestException(undefined, { description: "missing" }).message).toBe("missing");
  expect(new BadRequestException().message).toBe("Unexpected error");
});

test("StreamableFile defaults its type and reports no error", () => {
  const file = new StreamableFile(new Uint8Array([1]));
  expect(file.getHeaders()).toEqual({ "content-type": "application/octet-stream" });
  expect(file.getBuffer()).toEqual(new Uint8Array([1]));
  expect(file.getError()).toBeNull();
});

test("the serializer projects arrays and leaves dates alone", () => {
  const interceptor = new ClassSerializerInterceptor({ excludePrefixes: ["secret"] });
  const context = {
    getClass: () => class {},
    getHandler: () => function read(): void {},
  } as unknown as ExecutionContext;
  const date = new Date();
  expect(interceptor.interceptAfter(context, [{ name: "a", secretValue: 1 }, date])).toEqual([
    { name: "a" },
    date,
  ]);
});

test("normalizeProviderScope lowers every supported spelling", () => {
  expect(normalizeProviderScope(undefined)).toBe("singleton");
  expect(normalizeProviderScope(0)).toBe("singleton");
  expect(normalizeProviderScope(1)).toBe("transient");
  expect(normalizeProviderScope(2)).toBe("request");
  expect(normalizeProviderScope("singleton")).toBe("singleton");
  expect(normalizeProviderScope("transient")).toBe("transient");
  expect(normalizeProviderScope("request")).toBe("request");
  expect(normalizeProviderScope("custom" as never) as string).toBe("custom");
});
