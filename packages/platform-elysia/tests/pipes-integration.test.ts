import { describe, expect, test } from "bun:test";
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Module,
  Param,
  ParseBoolPipe,
  ParseFloatPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UsePipes,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

class MultiplyPipe implements PipeTransform<number, number> {
  #factor: number;

  constructor(factor = 2) {
    this.#factor = factor;
  }

  transform(value: number): number {
    return value * this.#factor;
  }
}

class TrimStringPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return typeof value === "string" ? value.trim() : value;
  }
}

@Controller("test")
class TestPipesController {
  @Get("items/:id")
  getItem(@Param("id", ParseIntPipe) id: number) {
    return { id, type: typeof id };
  }

  @Get("float/:val")
  getFloat(@Param("val", ParseFloatPipe) val: number) {
    return { val, type: typeof val };
  }

  @Get("bool")
  getBool(@Query("active", ParseBoolPipe) active: boolean) {
    return { active, type: typeof active };
  }

  @Get("uuid/:uuid")
  getUUID(@Param("uuid", ParseUUIDPipe) uuid: string) {
    return { uuid };
  }

  @Get("default")
  getDefault(@Query("limit", new DefaultValuePipe(25), ParseIntPipe) limit: number) {
    return { limit, type: typeof limit };
  }

  @Get("chained/:val")
  getChained(@Param("val", ParseIntPipe, new MultiplyPipe(3)) val: number) {
    return { val };
  }

  @UsePipes(TrimStringPipe)
  @Get("method-pipe")
  getMethodPipe(@Query("name") name: string) {
    return { name };
  }

  @Post("body-pipe")
  postBodyPipe(@Body("count", ParseIntPipe) count: number) {
    return { count, type: typeof count };
  }
}

@UsePipes(TrimStringPipe)
@Controller("class-piped")
class ClassPipedController {
  @Get("echo")
  echo(@Query("msg") msg: string) {
    return { msg };
  }
}

@Module({
  controllers: [TestPipesController, ClassPipedController],
})
class TestPipesModule {}

describe("Pipes Integration in Platform Elysia", () => {
  test("transforms parameter via ParseIntPipe", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/test/items/42"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: 42, type: "number" });
  });

  test("rejects invalid integer with 400 Bad Request", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/test/items/not-a-number"));

    expect(response.status).toBe(400);
  });

  test("transforms parameter via ParseFloatPipe", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/test/float/3.14159"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ val: 3.14159, type: "number" });
  });

  test("transforms boolean query parameter via ParseBoolPipe", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/test/bool?active=true"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ active: true, type: "boolean" });
  });

  test("validates UUID via ParseUUIDPipe", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const valid = "123e4567-e89b-12d3-a456-426614174000";
    const resSuccess = await app.handle(new Request(`http://localhost/test/uuid/${valid}`));

    expect(resSuccess.status).toBe(200);
    expect(await resSuccess.json()).toEqual({ uuid: valid });

    const resFail = await app.handle(new Request("http://localhost/test/uuid/invalid-uuid"));
    expect(resFail.status).toBe(400);
  });

  test("applies DefaultValuePipe before ParseIntPipe", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const resDefault = await app.handle(new Request("http://localhost/test/default"));

    expect(resDefault.status).toBe(200);
    expect(await resDefault.json()).toEqual({ limit: 25, type: "number" });

    const resCustom = await app.handle(new Request("http://localhost/test/default?limit=50"));
    expect(resCustom.status).toBe(200);
    expect(await resCustom.json()).toEqual({ limit: 50, type: "number" });
  });

  test("chains parameter pipes in declared order", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/test/chained/5"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ val: 15 });
  });

  test("applies method-level @UsePipes()", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/test/method-pipe?name=%20hello%20world%20"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "hello world" });
  });

  test("transforms body property via ParseIntPipe", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/test/body-pipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: "99" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 99, type: "number" });
  });

  test("applies class-level @UsePipes() across all routes", async () => {
    const app = await AponiaFactory.create(TestPipesModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/class-piped/echo?msg=%20trimmed%20text%20"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ msg: "trimmed text" });
  });
});
