import { expect, test } from "bun:test";
import {
  Controller,
  Cookie,
  Get,
  Module,
  Query,
  Validation,
  type RouteSchema,
} from "@aponiajs/common";
import { t } from "elysia";
import { AponiaFactory } from "../src/index.ts";

@Controller("missing-input")
class MissingInputController {
  @Get("cookie")
  readCookie(@Cookie("session") session: string | undefined): { readonly session: string | null } {
    return { session: session ?? null };
  }

  @Get("query")
  readQuery(@Query("term") term: string | undefined): { readonly term: string | null } {
    return { term: term ?? null };
  }
}

@Module({ controllers: [MissingInputController] })
class MissingInputModule {}

const userResponseValidator = t.Object({
  name: t.String({ minLength: 2 }),
});

@Validation(userResponseValidator)
class UserResponse {
  declare readonly name: string;
}

const userResponseSchema = { response: UserResponse } satisfies RouteSchema;

@Controller("response-model")
class ResponseModelController {
  @Get("valid", userResponseSchema)
  readValid(): { readonly name: string } {
    return { name: "Ada" };
  }

  @Get("invalid", userResponseSchema)
  readInvalid(): { readonly name: string } {
    return { name: "A" };
  }
}

@Module({ controllers: [ResponseModelController] })
class ResponseModelModule {}

test("binds a missing cookie or query property as undefined instead of failing", async () => {
  const application = await AponiaFactory.create(MissingInputModule, { logger: false });
  const noCookie = await application.handle(new Request("http://localhost/missing-input/cookie"));
  const otherCookie = await application.handle(
    new Request("http://localhost/missing-input/cookie", {
      headers: { cookie: "other=1" },
    }),
  );
  const presentCookie = await application.handle(
    new Request("http://localhost/missing-input/cookie", {
      headers: { cookie: "session=abc" },
    }),
  );
  const noQuery = await application.handle(new Request("http://localhost/missing-input/query"));
  const otherQuery = await application.handle(
    new Request("http://localhost/missing-input/query?other=1"),
  );

  expect(await noCookie.json()).toEqual({ session: null });
  expect(await otherCookie.json()).toEqual({ session: null });
  expect(await presentCookie.json()).toEqual({ session: "abc" });
  expect(await noQuery.json()).toEqual({ term: null });
  expect(await otherQuery.json()).toEqual({ term: null });
  await application.close();
});

test("lowers a single validation model in the response slot to its raw validator", async () => {
  const application = await AponiaFactory.create(ResponseModelModule, { logger: false });
  const valid = await application.handle(new Request("http://localhost/response-model/valid"));
  const invalid = await application.handle(new Request("http://localhost/response-model/invalid"));
  const route = application
    .getNativeApplication()
    .router.history.find((candidate) => candidate.path === "/response-model/valid");

  expect(await valid.json()).toEqual({ name: "Ada" });
  expect(invalid.status).toBe(422);
  expect(route?.hooks.response).toBe(userResponseValidator);
  await application.close();
});
