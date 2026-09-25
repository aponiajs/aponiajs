import { Controller, Get, Module, type AponiaError, type AponiaErrorCode } from "@aponiajs/common";
import { Elysia } from "elysia";
import { AponiaFactory } from "../src/index.ts";
import { registerNativeRoute } from "../src/routing/native-route.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

// The version guard raises a code the public union has to keep accepting.
const unsupportedElysiaCode = "UNSUPPORTED_ELYSIA_VERSION" satisfies AponiaErrorCode;

@Controller("conformance")
class NativeRouteController {
  @Get()
  read(): string {
    return "native";
  }
}

@Module({ controllers: [NativeRouteController] })
class NativeRouteModule {}

test("mounts a decorated controller through the native route boundary", async () => {
  const application = await AponiaFactory.create(NativeRouteModule, { logger: false });

  try {
    const response = await application.handle(new Request("http://localhost/conformance"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("native");
  } finally {
    await application.close();
  }
});

test("registers a raw native callback with Elysia 1.4 argument order", async () => {
  const application = new Elysia();
  registerNativeRoute(application, "GET", "/conformance", () => "native", undefined);

  const response = await application.handle(new Request("http://localhost/conformance"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("native");
});

test("refuses an application that does not expose route()", () => {
  let code: AponiaErrorCode | undefined;

  try {
    registerNativeRoute({} as Elysia, "GET", "/conformance", () => "", undefined);
  } catch (error) {
    code = (error as AponiaError).code;
  }

  expect(code).toBe(unsupportedElysiaCode);
});
