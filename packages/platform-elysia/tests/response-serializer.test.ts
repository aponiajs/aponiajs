import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Get, Module, Serialize } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("@Serialize", () => {
  test("shapes a route result after the handler runs", async () => {
    @Controller("serialize")
    class SerializedController {
      @Get()
      @Serialize((value, context) => ({ path: context.path, value }))
      read() {
        return { value: 1 };
      }
    }

    @Module({ controllers: [SerializedController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/serialize"));

    expect(await response.json()).toEqual({
      path: "/serialize",
      value: { value: 1 },
    });
  });

  test("lets a method serializer override the controller serializer", async () => {
    @Controller("override")
    @Serialize((value) => ({ class: value }))
    class OverrideController {
      @Get("method")
      @Serialize((value) => ({ method: value }))
      method() {
        return "value";
      }

      @Get("class")
      classLevel() {
        return "value";
      }
    }

    @Module({ controllers: [OverrideController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(
      await (await application.handle(new Request("http://localhost/override/method"))).json(),
    ).toEqual({
      method: "value",
    });
    expect(
      await (await application.handle(new Request("http://localhost/override/class"))).json(),
    ).toEqual({
      class: "value",
    });
  });

  test("leaves a route with no serializer untouched", async () => {
    @Controller("plain")
    class PlainController {
      @Get()
      read(): string {
        return "plain";
      }
    }

    @Module({ controllers: [PlainController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/plain"));

    expect(await response.text()).toBe("plain");
  });
});
