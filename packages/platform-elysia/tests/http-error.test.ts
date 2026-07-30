import { expect, test } from "bun:test";
import { Controller, Get, Module, defineModule } from "@aponiajs/common";
import { StatusMap } from "elysia";
import {
  AponiaFactory,
  HttpError,
  elysiaController,
  httpError,
  httpErrors,
  type HttpErrorStatusCode,
} from "../src/index.ts";

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

const typedNotFound = httpErrors.notFound();
const typedConflict = httpError("Conflict");
const typedUnprocessableContent = httpError(422);

type HttpErrorTypeAssertions = [
  Expect<Equals<typeof typedNotFound.status, 404>>,
  Expect<Equals<typeof typedConflict.status, 409>>,
  Expect<Equals<typeof typedUnprocessableContent.status, 422>>,
];

class ErrorController {}

const errorController = elysiaController(ErrorController, (application) =>
  application.get("/missing", () => {
    throw httpErrors.notFound("The requested resource does not exist.", {
      code: "RESOURCE_NOT_FOUND",
    });
  }),
);
const errorModule = defineModule({
  id: "ErrorModule",
  controllers: [errorController],
});

@Controller("decorated-missing")
class DecoratedErrorController {
  @Get()
  read(): never {
    throw httpErrors.gone("The decorated resource is no longer available.");
  }
}

@Module({ controllers: [DecoratedErrorController] })
class DecoratedErrorModule {}

test("provides a default factory for every Elysia 4xx and 5xx status", () => {
  const assertions: HttpErrorTypeAssertions = [true, true, true];
  const expectedStatuses = Object.values(StatusMap)
    .filter(
      (status): status is HttpErrorStatusCode =>
        typeof status === "number" && status >= 400 && status < 600,
    )
    .toSorted((left, right) => left - right);
  const factoryStatuses = Object.values(httpErrors)
    .map((createError) => createError().status)
    .toSorted((left, right) => left - right);

  expect(assertions).toEqual([true, true, true]);
  expect(factoryStatuses).toEqual(expectedStatuses);
  expect(new Set(factoryStatuses).size).toBe(expectedStatuses.length);
  expect(Object.isFrozen(httpErrors)).toBe(true);
});

test("creates safe RFC 9457 defaults", async () => {
  const cause = new Error("database credentials must stay private");
  const error = httpErrors.internalServerError({ cause });
  const response = error.toResponse();
  const body = (await response.json()) as Record<string, unknown>;

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(HttpError);
  expect(error.name).toBe("HttpError");
  expect(error.message).toBe("Internal Server Error");
  expect(error.cause).toBe(cause);
  expect(error.status).toBe(500);
  expect(error.code).toBe("INTERNAL_SERVER_ERROR");
  expect(Object.isFrozen(error.problem)).toBe(true);
  expect(Object.isFrozen(error.headers)).toBe(true);
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(body).toEqual({
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
    detail: "Internal Server Error",
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(JSON.stringify(body)).not.toContain("database credentials");
  expect(JSON.stringify(body)).not.toContain("stack");
  expect(error.toResponse()).not.toBe(response);
});

test("flows through both Elysia composition policies without an error adapter", async () => {
  for (const aot of [true, false]) {
    const application = await AponiaFactory.create(errorModule, {
      logger: false,
      elysia: { aot },
    });
    const response = await application.handle(new Request("http://localhost/missing"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "The requested resource does not exist.",
      code: "RESOURCE_NOT_FOUND",
    });
    await application.close();
  }
});

test("works from a compiled decorated controller", async () => {
  const application = await AponiaFactory.create(DecoratedErrorModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/decorated-missing"));

  expect(response.status).toBe(410);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(await response.json()).toEqual({
    type: "about:blank",
    title: "Gone",
    status: 410,
    detail: "The decorated resource is no longer available.",
    code: "GONE",
  });
  await application.close();
});

test("supports details, stable codes, headers, instances, and extensions", async () => {
  const error = httpError(422, "The submitted profile is invalid.", {
    code: "PROFILE_INVALID",
    type: "https://aponiajs.dev/problems/profile-invalid",
    instance: "/profiles/request-42",
    headers: {
      "content-type": "text/plain",
      "retry-after": "30",
    },
    extensions: {
      field: "email",
      type: "extension-must-not-replace-rfc-member",
      title: "extension-must-not-replace-rfc-member",
      status: 599,
      detail: "extension-must-not-replace-rfc-member",
      instance: "extension-must-not-replace-rfc-member",
      code: "extension-must-not-replace-code",
      name: "extension-must-not-expose-error-name",
      message: "extension-must-not-expose-error-message",
      stack: "extension-must-not-expose-stack",
      cause: "extension-must-not-expose-cause",
    },
  });
  const response = error.toResponse();

  expect(error.problem).toEqual({
    type: "https://aponiajs.dev/problems/profile-invalid",
    title: "Unprocessable Content",
    status: 422,
    detail: "The submitted profile is invalid.",
    instance: "/profiles/request-42",
    code: "PROFILE_INVALID",
    field: "email",
  });
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(response.headers.get("retry-after")).toBe("30");
  expect(await response.json()).toEqual(error.problem);
});

test("accepts status names and object-style convenience options", () => {
  const unauthorized = new HttpError("Unauthorized", {
    detail: "A valid session is required.",
  });
  const teapot = httpErrors.imATeapot("Short and stout.");
  const version = httpErrors.httpVersionNotSupported();

  expect(unauthorized.status).toBe(401);
  expect(unauthorized.code).toBe("UNAUTHORIZED");
  expect(teapot.status).toBe(418);
  expect(teapot.code).toBe("IM_A_TEAPOT");
  expect(teapot.message).toBe("Short and stout.");
  expect(version.code).toBe("HTTP_VERSION_NOT_SUPPORTED");
});

test("rejects statuses outside Elysia's known error set at runtime", () => {
  expect(() => new HttpError(200 as never)).toThrow(
    "HttpError requires a known 4xx or 5xx status; received 200.",
  );
  expect(() => new HttpError(419 as never)).toThrow(
    "HttpError requires a known 4xx or 5xx status; received 419.",
  );
});
