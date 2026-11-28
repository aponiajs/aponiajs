import { describe, expect, test } from "bun:test";
import {
  Body,
  Context,
  Controller,
  Cookie,
  createParamDecorator,
  Get,
  Headers,
  HostParam,
  Ip,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  ResponseSettings,
  type PipeTransform,
  type ResponseSettingsState,
  type RouteContext,
} from "@aponiajs/common";
import { status } from "elysia";
import { AponiaFactory } from "./index.ts";

interface RequestUser {
  id: number;
  name: string;
  role: string;
}

const CurrentUser = createParamDecorator<keyof RequestUser | undefined, unknown>(
  (data, context: RouteContext) => {
    const user = (context as { user?: RequestUser }).user;
    if (user === undefined) {
      return undefined;
    }
    return data ? user[data] : user;
  },
);

const RequestHeaderToken = createParamDecorator<string, string | undefined>(
  (headerName, context: RouteContext) => {
    if (!headerName) {
      return undefined;
    }
    return context.request.headers.get(headerName) ?? undefined;
  },
);

class UpperCasePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return typeof value === "string" ? value.toUpperCase() : value;
  }
}

@Controller("custom-param")
class CustomParamController {
  @Get("full-user")
  getFullUser(@CurrentUser() user: RequestUser) {
    return { user };
  }

  @Get("user-field")
  getUserField(@CurrentUser("name") name: string, @CurrentUser("role") role: string) {
    return { name, role };
  }

  @Get("piped")
  getPipedUserRole(@CurrentUser("role", UpperCasePipe) role: string) {
    return { role };
  }

  @Get("header-token")
  getToken(@RequestHeaderToken("x-custom-token") token: string) {
    return { token };
  }

  @Get("piped-num")
  getPipedNum(@CurrentUser("id", ParseIntPipe) id: number) {
    return { id, type: typeof id };
  }
}

@Module({
  controllers: [CustomParamController],
})
class CustomParamModule {}

describe("Custom parameter decorators in @aponiajs/platform-elysia", () => {
  test("extracts custom parameter without pipes", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: 42, name: "Alice", role: "admin" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/full-user"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: RequestUser };
    expect(body.user).toEqual({ id: 42, name: "Alice", role: "admin" });
  });

  test("extracts specific field via custom parameter decorator data argument", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: 42, name: "Alice", role: "admin" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/user-field"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; role: string };
    expect(body).toEqual({ name: "Alice", role: "admin" });
  });

  test("executes parameter pipes after custom parameter factory extraction", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: 42, name: "Alice", role: "admin" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/piped"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { role: string };
    expect(body).toEqual({ role: "ADMIN" });
  });

  test("extracts raw native request headers via custom parameter", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
    });

    const response = await app.handle(
      new Request("http://localhost/custom-param/header-token", {
        headers: { "x-custom-token": "secret-xyz" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body).toEqual({ token: "secret-xyz" });
  });

  test("combines custom parameter extraction with ParseIntPipe", async () => {
    const app = await AponiaFactory.create(CustomParamModule, {
      logger: false,
      configureNative: (elysia) => {
        return elysia.derive(() => ({
          user: { id: "123", name: "Bob", role: "user" },
        }));
      },
    });

    const response = await app.handle(new Request("http://localhost/custom-param/piped-num"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number; type: string };
    expect(body).toEqual({ id: 123, type: "number" });
  });

  test("combines custom parameter with all standard parameter sources", async () => {
    @Controller("mixed-custom")
    class MixedCustomController {
      @Post(":id")
      mixed(
        @CurrentUser("name") userName: string,
        @Body() body: unknown,
        @Query("q") q: string,
        @Param("id") id: string,
        @Headers("x-a") xa: string,
        @Cookie("c") c: string,
        @HostParam() host: string,
        @Ip() ip: string | undefined,
        @Req() req: Request,
        @ResponseSettings() set: ResponseSettingsState,
        @Context() ctx: RouteContext,
      ) {
        set.headers["x-mixed"] = "ok";
        return {
          userName,
          body,
          q,
          id,
          xa,
          c,
          host,
          hasIp: ip !== undefined,
          method: req.method,
          hasCtx: ctx.request === req,
        };
      }
    }

    @Module({ controllers: [MixedCustomController] })
    class MixedCustomModule {}

    const app = await AponiaFactory.create(MixedCustomModule, {
      logger: false,
      configureNative: (elysia) =>
        elysia.derive(() => ({
          user: { id: 1, name: "Alice", role: "admin" },
        })),
    });

    const response = await app.handle(
      new Request("http://example.com/mixed-custom/42?q=hi", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-a": "hdr",
          cookie: "c=val",
        },
        body: JSON.stringify({ ok: true }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-mixed")).toBe("ok");
    expect(await response.json()).toEqual({
      userName: "Alice",
      body: { ok: true },
      q: "hi",
      id: "42",
      xa: "hdr",
      c: "val",
      host: "example.com",
      hasIp: false,
      method: "POST",
      hasCtx: true,
    });

    @Controller("fast-status")
    class FastStatusController {
      @Get("json")
      jsonStatus(): string {
        throw status(418, { teapot: true });
      }
      @Get("resp")
      respStatus(): string {
        throw status(201, new Response("created", { status: 201 }));
      }
      @Get("str")
      strStatus(): string {
        throw status(418, "teapot");
      }
      @Get("err")
      errStatus(): string {
        throw new Error("boom");
      }
      @Get("multi-pipe")
      multiPipe(@Query("a", ParseIntPipe) a: number, @Query("b", ParseIntPipe) b: number): number {
        return a + b;
      }
      @Get("multi-pipe-async")
      async multiPipeAsync(
        @Query("a", ParseIntPipe) a: number,
        @Query("b", ParseIntPipe) b: number,
      ): Promise<number> {
        return a * b;
      }
    }
    @Module({ controllers: [FastStatusController] })
    class FastStatusModule {}

    const statusApp = await AponiaFactory.create(FastStatusModule, { logger: false });
    const r1 = await statusApp.handle(new Request("http://localhost/fast-status/json"));
    expect(r1.status).toBe(418);
    const r2 = await statusApp.handle(new Request("http://localhost/fast-status/resp"));
    expect(r2.status).toBe(201);
    const r3 = await statusApp.handle(new Request("http://localhost/fast-status/str"));
    expect(r3.status).toBe(418);
    const r4 = await statusApp.handle(new Request("http://localhost/fast-status/err"));
    expect(r4.status).toBe(500);
    const r5 = await statusApp.handle(
      new Request("http://localhost/fast-status/multi-pipe?a=3&b=4"),
    );
    expect(await r5.json()).toBe(7);
    const r6 = await statusApp.handle(
      new Request("http://localhost/fast-status/multi-pipe-async?a=3&b=4"),
    );
    expect(await r6.json()).toBe(12);

    // Sparse piped param (index 1 without index 0) + async pipe in sync handler
    @Controller("sparse-pipe")
    class SparsePipeController {
      @Get()
      sparse(
        unannotated: unknown,
        @Query("n", { transform: async (v: unknown) => Number(v) + 1 }) n: number,
      ): number {
        return unannotated === undefined ? n : 0;
      }
    }
    @Module({ controllers: [SparsePipeController] })
    class SparsePipeModule {}
    const sparseApp = await AponiaFactory.create(SparsePipeModule, { logger: false });
    const r7 = await sparseApp.handle(new Request("http://localhost/sparse-pipe?n=9"));
    expect(await r7.json()).toBe(10);

    @Controller("piped-strip")
    class PipedStripController {
      @Get()
      readAll(
        @Headers() hdrs: Record<string, unknown>,
        @Headers("__proto__") proto: unknown,
        @Ip() ip: unknown,
        @HostParam("0") hostLabel: string,
        @Cookie("c") cookieVal: unknown,
        @Req() req: Request,
      ): {
        hasHdr: boolean;
        protoUndefined: boolean;
        hostLabel: string;
        hasReq: boolean;
        ipType: string;
        cookieVal: unknown;
      } {
        return {
          hasHdr: typeof hdrs === "object" && hdrs !== null,
          protoUndefined: proto === undefined,
          hostLabel,
          hasReq: req instanceof Request,
          ipType: typeof ip,
          cookieVal: cookieVal ?? null,
        };
      }

      @Get("async-multi")
      async readAsync(
        @Headers("x-a") xa: string,
        @Query("n", ParseIntPipe) n: number,
      ): Promise<{ xa: string; n: number }> {
        return { xa, n };
      }
    }
    @Module({ controllers: [PipedStripController] })
    class PipedStripModule {}
    const stripApp = await AponiaFactory.create(PipedStripModule, {
      logger: false,
      pipes: [{ transform: (v: unknown) => v }],
    });
    const r8 = await stripApp.handle(new Request("http://api.localhost/piped-strip"));
    expect(await r8.json()).toEqual({
      hasHdr: true,
      protoUndefined: true,
      hostLabel: "api",
      hasReq: true,
      ipType: "undefined",
      cookieVal: null,
    });
    const r9 = await stripApp.handle(
      new Request("http://api.localhost/piped-strip/async-multi?n=7", {
        headers: { "x-a": "ok" },
      }),
    );
    expect(await r9.json()).toEqual({ xa: "ok", n: 7 });
  });
});
