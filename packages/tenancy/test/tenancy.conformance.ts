import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  MODULE_OPTIONS_TOKEN,
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

  @Module({
    imports: [TenantModule.register({ header: "x-tenant-id" })],
    controllers: [TenantController],
  })
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

test("the registration is a builder definition with an options token and extras", () => {
  const definition = TenantModule.forRoot({ header: "x-tenant-id", isGlobal: true });
  const asyncDefinition = TenantModule.forRootAsync({
    useFactory: async () => ({ header: "x-tenant-id" }),
  });

  expect(definition.module).toBe(TenantModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(asyncDefinition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(() => TenantModule.forRoot()).toThrow();
});
