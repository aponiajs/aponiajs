import { expect, test } from "bun:test";
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { createPlatformFactory, type AponiaApplicationContract } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { TenantGuard, TenantModule, TenantService } from "../src/index.ts";

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

// The tenant lives in the shared request context and the refusal is an
// `HttpError`, so the same module resolves a tenant on every platform.
async function assertTenantResolved(application: AponiaApplicationContract): Promise<void> {
  const allowed = await application.handle(
    new Request("http://localhost/tenant", { headers: { "x-tenant-id": "acme" } }),
  );
  expect(allowed.status).toBe(200);
  expect(await allowed.text()).toBe("acme");

  const refused = await application.handle(new Request("http://localhost/tenant"));
  expect(refused.status).toBe(400);
}

test("resolves a tenant from the request context on hono", async () => {
  const application = await createPlatformFactory(honoAdapter()).create(AppModule, {
    logger: false,
  });

  try {
    await assertTenantResolved(application);
  } finally {
    await application.close();
  }
});

test("resolves a tenant from the request context on h3", async () => {
  const application = await createPlatformFactory(h3Adapter()).create(AppModule, { logger: false });

  try {
    await assertTenantResolved(application);
  } finally {
    await application.close();
  }
});
