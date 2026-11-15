import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("strictCodegen", () => {
  test("refuses a compiled route that has no generated invoker", async () => {
    @Controller("strict")
    class StrictController {
      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({ controllers: [StrictController] })
    class AppModule {}

    expect(
      AponiaFactory.create(AppModule, { logger: false, strictCodegen: true }),
    ).rejects.toMatchObject({
      code: "UNSAFE_CODE_GENERATION",
      details: {
        controller: "StrictController",
        handler: "read",
        method: "GET",
        path: "/strict",
      },
    });
  });

  test("boots a generated invoker artifact and answers through it", async () => {
    @Controller("strict")
    class StrictController {
      @Get()
      read(): string {
        return "compiled";
      }
    }

    @Module({ controllers: [StrictController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, {
      logger: false,
      strictCodegen: true,
      invokers: {
        framework: aponiaVersion,
        elysia: "2.0.0-beta.24",
        invokers: new Map([[StrictController, () => new Map([["read", () => "generated"]])]]),
      },
    });

    const response = await application.handle(new Request("http://localhost/strict"));
    expect(await response.text()).toBe("generated");
  });

  test("keeps the compatible runtime compiler available when strict is omitted", async () => {
    @Controller("compat")
    class CompatController {
      @Get()
      read(): string {
        return "compiled";
      }
    }

    @Module({ controllers: [CompatController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    expect(await (await application.handle(new Request("http://localhost/compat"))).text()).toBe(
      "compiled",
    );
  });
});
