import { afterEach, describe, expect, test } from "bun:test";
import {
  Body,
  Context,
  Controller,
  Cookie,
  Headers,
  Module,
  Param,
  Post,
  Query,
  Req,
  State,
  UsePipes,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "../src/index.ts";

class IdentityPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown): unknown {
    return value;
  }
}

@Controller("args")
@UsePipes(IdentityPipe)
class ArgsController {
  @Post("three/:id")
  three(
    @Body() body: { readonly name: string },
    @Query("q") query: string,
    @Param("id") id: string,
  ): unknown {
    return { body, query, id };
  }

  @Post("four/:id")
  four(
    @Body() body: { readonly name: string },
    @Query("q") query: string,
    @Param("id") id: string,
    @Headers("x-test") header: string,
  ): unknown {
    return { body, query, id, header };
  }

  @Post("context/:id")
  context(
    @Req() request: Request,
    @Context() context: unknown,
    @Cookie("session") cookie: unknown,
    @State("tenant") tenant: unknown,
  ): unknown {
    return { url: request.url, hasContext: context !== undefined, cookie, tenant };
  }
}

@Module({ controllers: [ArgsController] })
class ArgsModule {}

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("route argument arity", () => {
  test("compiles the three-argument and variadic parameter plans", async () => {
    application = await AponiaFactory.create(ArgsModule, { logger: false });
    const three = await application.handle(
      new Request("http://localhost/args/three/42?q=ada", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test": "header" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    expect(await three.json()).toEqual({
      body: { name: "Ada" },
      query: "ada",
      id: "42",
    });

    const four = await application.handle(
      new Request("http://localhost/args/four/42?q=ada", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test": "header" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    expect(await four.json()).toEqual({
      body: { name: "Ada" },
      query: "ada",
      id: "42",
      header: "header",
    });
  });

  test("reads request, context, cookie, and state sources", async () => {
    application = await AponiaFactory.create(ArgsModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/args/context/42?q=ada", {
        method: "POST",
        headers: { cookie: "session=abc" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    expect(await response.json()).toMatchObject({
      hasContext: true,
      cookie: "abc",
    });
  });
});
