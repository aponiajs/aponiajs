import { afterEach, describe, expect, test } from "bun:test";
import {
  Controller,
  createToken,
  Get,
  Inject,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
} from "@aponiajs/common";
import {
  AponiaFactory,
  RequestContextModule,
  RequestContextService,
  type AponiaApplication,
} from "@aponiajs/platform-elysia";
import { TenantGuard, TenantModule, TenantService } from "../src/index.ts";

const TENANT_PRINCIPAL = createToken<Readonly<Record<string, unknown>>>("test.tenant.principal");

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("TenantModule", () => {
  test("shares the request-context registration another module also imports", () => {
    const tenantModule = TenantModule.register({ header: "x-tenant-id" });

    expect(tenantModule.imports?.[0]).toBe(RequestContextModule.forRoot());
  });

  test("resolves a tenant from an explicit header and exposes it in the handler", async () => {
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

  test("does not read a tenant header unless the registration opts in", async () => {
    @Controller("no-header")
    @UseGuards(TenantGuard)
    class NoHeaderController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.current() ?? "none";
      }
    }

    @Module({
      imports: [
        TenantModule.register({
          resolver: () => undefined,
          required: false,
        }),
      ],
      controllers: [NoHeaderController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/no-header", { headers: { "x-tenant-id": "acme" } }),
    );

    expect(await response.text()).toBe("none");
  });

  test("supports an optional tenant", async () => {
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
      imports: [TenantModule.register({ header: "x-tenant-id", required: false })],
      controllers: [OptionalController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    expect(await (await application.handle(new Request("http://localhost/optional"))).text()).toBe(
      "none",
    );
  });

  test("uses a resolver before every other source", async () => {
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
      imports: [
        TenantModule.register({
          header: "x-tenant-id",
          resolver: () => "resolved",
        }),
      ],
      controllers: [ResolvedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/resolved", { headers: { "x-tenant-id": "ignored" } }),
    );

    expect(await response.text()).toBe("resolved");
  });

  test("reads the tenant from a verified principal claim", async () => {
    @Injectable()
    class PrincipalGuard implements CanActivate {
      constructor(@Inject(RequestContextService) private readonly context: RequestContextService) {}

      canActivate(): boolean {
        this.context.current()?.set(TENANT_PRINCIPAL, { tenantId: "acme" });
        return true;
      }
    }

    @Controller("principal")
    @UseGuards(PrincipalGuard, TenantGuard)
    class PrincipalController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.require();
      }
    }

    @Module({
      imports: [RequestContextModule.forRoot()],
      providers: [PrincipalGuard],
      exports: [PrincipalGuard],
    })
    class PrincipalModule {}

    @Module({
      imports: [TenantModule.register({ principal: TENANT_PRINCIPAL }), PrincipalModule],
      controllers: [PrincipalController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/principal"));

    expect(await response.text()).toBe("acme");
  });

  test("reports an invalid tenancy registration", () => {
    expect(() => TenantModule.register()).toThrow(
      expect.objectContaining({ code: "INVALID_TENANCY_OPTIONS" }),
    );
    expect(() => TenantModule.register({ header: "" })).toThrow(
      expect.objectContaining({ code: "INVALID_TENANCY_OPTIONS" }),
    );
    expect(() => TenantModule.register({ required: "yes" as never })).toThrow(
      expect.objectContaining({ code: "INVALID_TENANCY_OPTIONS" }),
    );
    expect(() => TenantModule.register({ principal: {} as never })).toThrow(
      expect.objectContaining({ code: "INVALID_TENANCY_OPTIONS" }),
    );
  });

  test("answers 400 when require() finds no tenant for the request", async () => {
    @Controller("unguarded")
    class UnguardedController {
      constructor(private readonly tenant: TenantService) {}

      @Get()
      read(): string {
        return this.tenant.require();
      }
    }

    @Module({
      imports: [TenantModule.register({ header: "x-tenant-id", required: false })],
      controllers: [UnguardedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/unguarded"));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
