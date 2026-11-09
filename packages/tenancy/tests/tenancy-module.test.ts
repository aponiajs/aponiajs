import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { TenantGuard, TenantModule, TenantService } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("TenantModule", () => {
  test("resolves a tenant from the default header and exposes it in the handler", async () => {
    @Controller("tenant")
    @UseGuards(TenantGuard)
    class TenantController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.require();
      }
    }

    @Module({ imports: [TenantModule.register()], controllers: [TenantController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const allowed = await application.handle(
      new Request("http://localhost/tenant", { headers: { "x-tenant-id": "acme" } }),
    );
    expect(await allowed.text()).toBe("acme");

    expect((await application.handle(new Request("http://localhost/tenant"))).status).toBe(400);
    expect(
      (
        await application.handle(
          new Request("http://localhost/tenant", { headers: { "x-tenant-id": "bad tenant!" } }),
        )
      ).status,
    ).toBe(400);
  });

  test("supports an optional tenant and a custom resolver", async () => {
    @Controller("optional")
    @UseGuards(TenantGuard)
    class OptionalController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.current() ?? "none";
      }
    }

    @Module({
      imports: [TenantModule.register({ required: false })],
      controllers: [OptionalController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    expect(await (await application.handle(new Request("http://localhost/optional"))).text()).toBe(
      "none",
    );
  });

  test("uses a resolver before the header and validates the resolved identifier", async () => {
    @Controller("resolved")
    @UseGuards(TenantGuard)
    class ResolvedController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.current() ?? "none";
      }
    }

    @Module({
      imports: [TenantModule.register({ resolver: () => "resolved" })],
      controllers: [ResolvedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    expect(await (await application.handle(new Request("http://localhost/resolved"))).text()).toBe(
      "resolved",
    );
  });

  test("reports an invalid tenancy registration", () => {
    expect(() => TenantModule.register({ header: "" })).toThrow(
      expect.objectContaining({ code: "INVALID_TENANCY_OPTIONS" }),
    );
    expect(() => TenantModule.register({ required: "yes" as never })).toThrow(
      expect.objectContaining({ code: "INVALID_TENANCY_OPTIONS" }),
    );
  });

  test("refuses require() when no tenant is selected for the request", async () => {
    @Controller("unguarded")
    class UnguardedController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.require();
      }
    }

    @Module({
      imports: [TenantModule.register({ required: false })],
      controllers: [UnguardedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/unguarded"));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
