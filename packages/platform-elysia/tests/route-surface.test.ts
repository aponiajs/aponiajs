import { describe, expect, test } from "bun:test";
import {
  All,
  Controller,
  Get,
  Header,
  HostParam,
  HttpCode,
  Ip,
  Module,
  UseGuards,
  type CanActivate,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

class PassThroughPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}

@Controller("surface")
class SurfaceController {
  @All("webhook")
  receive(): { readonly method: string } {
    return { method: "any" };
  }

  @Get("declared")
  @Header("cache-control", "no-store")
  @Header("x-list", ["a", "b"])
  @HttpCode(202)
  declared(): { readonly ok: boolean } {
    return { ok: true };
  }

  @Get("ip")
  address(@Ip() ip: string | undefined): { readonly ip: string | undefined } {
    return { ip };
  }

  @Get("host")
  host(
    @HostParam() host: string,
    @HostParam("tenant") tenant: string,
  ): { readonly host: string; readonly tenant: string } {
    return { host, tenant };
  }

  @Get("host-piped")
  hostPiped(@HostParam("tenant", PassThroughPipe) tenant: string): { readonly tenant: string } {
    return { tenant };
  }
}

@Module({ controllers: [SurfaceController] })
class SurfaceModule {}

describe("route response metadata", () => {
  test("@All answers every method on its path", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });

    try {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const response = await application.handle(
          new Request("http://localhost/surface/webhook", { method }),
        );
        expect(response.status, method).toBe(200);
        expect(await response.json()).toEqual({ method: "any" });
      }
    } finally {
      await application.close();
    }
  });

  test("@Header and @HttpCode shape the response", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });

    try {
      const response = await application.handle(new Request("http://localhost/surface/declared"));

      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await application.close();
    }
  });

  test("@Ip binds the peer address over a real socket", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });
    await application.listen(0);

    try {
      const response = await fetch(`${application.getUrl()}/surface/ip`);
      const body = (await response.json()) as { readonly ip?: string };

      expect(typeof body.ip).toBe("string");
      expect(body.ip?.length).toBeGreaterThan(0);
    } finally {
      await application.close();
    }
  });

  test("@HostParam binds the host and its first label", async () => {
    const application = await AponiaFactory.create(SurfaceModule, { logger: false });

    try {
      const response = await application.handle(
        new Request("http://acme.example.com/surface/host"),
      );

      expect(await response.json()).toEqual({
        host: "acme.example.com",
        tenant: "acme",
      });

      const piped = await application.handle(
        new Request("http://acme.example.com/surface/host-piped"),
      );
      expect(await piped.json()).toEqual({ tenant: "acme" });
    } finally {
      await application.close();
    }
  });

  test("a refusal answers its own status while keeping declared headers", async () => {
    class RefuseGuard implements CanActivate {
      canActivate(): boolean {
        return false;
      }
    }

    @Controller("guarded")
    class GuardedController {
      @Get()
      @UseGuards(RefuseGuard)
      @Header("x-declared", "yes")
      @HttpCode(202)
      guarded(): string {
        return "never";
      }
    }

    @Module({ controllers: [GuardedController], providers: [RefuseGuard] })
    class GuardedModule {}

    const application = await AponiaFactory.create(GuardedModule, { logger: false });
    try {
      const response = await application.handle(new Request("http://localhost/guarded"));
      expect(response.status).toBe(403);
      expect(response.headers.get("x-declared")).toBe("yes");
    } finally {
      await application.close();
    }
  });

  test("an @All route conflicts with a single-method route on the same path", async () => {
    @Controller("conflict")
    class ConflictController {
      @All("item")
      all() {
        return "all";
      }

      @Get("item")
      get() {
        return "get";
      }
    }

    @Module({ controllers: [ConflictController] })
    class ConflictModule {}

    let failure: unknown;
    try {
      await AponiaFactory.create(ConflictModule, { logger: false });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "DUPLICATE_ROUTE" });
  });
});
