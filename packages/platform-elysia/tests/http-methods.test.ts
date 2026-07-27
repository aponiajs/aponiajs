import { expect, test } from "bun:test";
import { Controller, Delete, Get, Head, Module, Options, Patch, Post, Put } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

@Controller("methods")
class MethodController {
  @Delete()
  removeItem(): string {
    return "DELETE";
  }

  @Get()
  readItem(): string {
    return "GET";
  }

  @Head()
  inspectItem(): string {
    return "HEAD";
  }

  @Options()
  describeItem(): string {
    return "OPTIONS";
  }

  @Patch()
  amendItem(): string {
    return "PATCH";
  }

  @Post()
  createItem(): string {
    return "POST";
  }

  @Put()
  replaceItem(): string {
    return "PUT";
  }
}

@Module({ controllers: [MethodController] })
class MethodModule {}

const methods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;

test("maps every HTTP method decorator", async () => {
  const application = await AponiaFactory.create(MethodModule, { logger: false });

  for (const method of methods) {
    const response = await application.handle(new Request("http://localhost/methods", { method }));

    expect(response.status).toBe(200);
    if (method !== "HEAD") {
      expect(await response.text()).toBe(method);
    }
  }
});
