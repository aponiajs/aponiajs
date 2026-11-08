import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  TenantGuard,
  TenantModule,
  TenantService,
  type TenantModuleOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented tenancy options", () => {
  const options: TenantModuleOptions = { header: "x-tenant", required: true };
  expect(options.header).toBe("x-tenant");
});

test("boots and resolves a tenant through the guard", async () => {
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

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(
      new Request("http://localhost/tenant", { headers: { "x-tenant-id": "acme" } }),
    );
    expect(await response.text()).toBe("acme");
  } finally {
    await application.close();
  }
});
