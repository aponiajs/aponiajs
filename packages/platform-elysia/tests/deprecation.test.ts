import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Deprecated, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("@Deprecated routes", () => {
  test("answer the deprecation, sunset, and replacement link headers", async () => {
    @Controller("legacy")
    @Deprecated({ sunset: "2027-01-01T00:00:00Z", link: "https://api.example.com/v2/legacy" })
    class LegacyController {
      @Get()
      read(): string {
        return "legacy";
      }

      @Get("updated")
      @Deprecated({ link: "https://api.example.com/v3/legacy" })
      updated(): string {
        return "updated";
      }
    }

    @Controller("current")
    class CurrentController {
      @Get()
      read(): string {
        return "current";
      }
    }

    @Module({ controllers: [LegacyController, CurrentController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const legacy = await application.handle(new Request("http://localhost/legacy"));
    const updated = await application.handle(new Request("http://localhost/legacy/updated"));
    const current = await application.handle(new Request("http://localhost/current"));

    expect(legacy.headers.get("deprecation")).toBe("true");
    expect(legacy.headers.get("sunset")).toBe("Fri, 01 Jan 2027 00:00:00 GMT");
    expect(legacy.headers.get("link")).toBe(
      '<https://api.example.com/v2/legacy>; rel="deprecation"',
    );
    expect(updated.headers.get("deprecation")).toBe("true");
    expect(updated.headers.get("sunset")).toBeNull();
    expect(updated.headers.get("link")).toBe(
      '<https://api.example.com/v3/legacy>; rel="deprecation"',
    );
    expect(current.headers.get("deprecation")).toBeNull();
  });

  test("keep the headers on a route's failure response", async () => {
    @Controller("legacy")
    @Deprecated({ link: "https://api.example.com/v2" })
    class FailingController {
      @Get()
      read(): string {
        throw new Error("origin failed");
      }
    }

    @Module({ controllers: [FailingController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/legacy"));

    expect(response.status).toBe(500);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("link")).toBe('<https://api.example.com/v2>; rel="deprecation"');
  });
});
