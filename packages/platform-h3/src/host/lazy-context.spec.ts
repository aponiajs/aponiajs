import { describe, expect, test } from "bun:test";
import {
  Body,
  Controller,
  Cookie,
  Get,
  Headers,
  HostParam,
  HttpStatus,
  Ip,
  Module,
  Param,
  Post,
  Query,
  ResponseSettings,
  State,
  type ResponseSettingsState,
} from "@aponiajs/common";
import { AponiaFactory } from "../index.ts";

@Controller("lazy")
class LazyController {
  @Get(":id")
  inspect(
    @Param("id") id: string,
    @Query("q") q: string,
    @Headers("x-test") hdr: string,
    @Cookie("sid") sid: string,
    @HostParam() host: string,
    @Ip() ip: string | undefined,
    @ResponseSettings() set: ResponseSettingsState,
  ) {
    set.status = 202;
    set.headers["x-lazy"] = "yes";
    return { id, q, hdr, sid, host, hasIp: ip !== undefined };
  }

  @Post("echo")
  echo(
    @Body() body: unknown,
    @State() store: Record<string, unknown>,
    @HttpStatus() status: (code: number, body?: unknown) => Response,
    @Headers() allHeaders: Record<string, unknown>,
    @Query() allQuery: Record<string, unknown>,
    @Param() allParams: Record<string, unknown>,
    @Cookie() allCookies: Record<string, unknown>,
  ) {
    return status(201, {
      body,
      hasStore: typeof store === "object",
      hasAll: Boolean(allHeaders && allQuery && allParams && allCookies),
    });
  }

  @Post("validated/:id", {
    body: { "~standard": { version: 1, vendor: "t", validate: (v: unknown) => ({ value: v }) } },
    query: { "~standard": { version: 1, vendor: "t", validate: (v: unknown) => ({ value: v }) } },
    params: { "~standard": { version: 1, vendor: "t", validate: (v: unknown) => ({ value: v }) } },
    headers: { "~standard": { version: 1, vendor: "t", validate: (v: unknown) => ({ value: v }) } },
    cookie: { "~standard": { version: 1, vendor: "t", validate: (v: unknown) => ({ value: v }) } },
  })
  validated(@Body() body: unknown, @Param("id") id: string, @Query("q") q: string) {
    return { body, id, q };
  }
}

@Module({ controllers: [LazyController] })
class LazyModule {}

describe("LazyH3RouteContext", () => {
  test("materializes params, query, headers, cookie, host, ip, body, and settings lazily", async () => {
    const app = await AponiaFactory.create(LazyModule, { logger: false });
    const res = await app.handle(
      new Request("http://example.com/lazy/7?q=hi", {
        headers: {
          "x-test": "val",
          cookie: "sid=abc123",
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(res.headers.get("x-lazy")).toBe("yes");
    expect(await res.json()).toEqual({
      id: "7",
      q: "hi",
      hdr: "val",
      sid: "abc123",
      host: "example.com",
      hasIp: false,
    });

    const postRes = await app.handle(
      new Request("http://example.com/lazy/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
    );
    expect(postRes.status).toBe(201);
    expect(await postRes.json()).toEqual({
      body: { hello: "world" },
      hasStore: true,
      hasAll: true,
    });

    const valRes = await app.handle(
      new Request("http://example.com/lazy/validated/9?q=v", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "s=1" },
        body: JSON.stringify({ x: 1 }),
      }),
    );
    expect(valRes.status).toBe(200);
    expect(await valRes.json()).toEqual({ body: { x: 1 }, id: "9", q: "v" });

    await app.listen(0);
    try {
      const liveRes = await fetch(`${app.getUrl()}/lazy/9?q=live`);
      expect(liveRes.status).toBe(202);
    } finally {
      await app.close();
    }
  });
});
