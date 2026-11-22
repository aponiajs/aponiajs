import { describe, expect, test } from "bun:test";
import { Controller, Get, Module, type RouteContext } from "@aponiajs/common";
import { clearCookie, createPlatformFactory, writeCookie } from "../src/index.ts";
import { fakeHost } from "./fixtures/fake-host.ts";

type Settings = { headers: Record<string, string | number | string[] | undefined> };

function settings(): Settings {
  return { headers: {} };
}

function cookieHeaders(set: Settings): readonly unknown[] {
  const value = set.headers["set-cookie"];
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

describe("writeCookie", () => {
  test("serializes the attributes the caller stated", () => {
    const set = settings();
    writeCookie(set, "session", "abc 123", {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60,
      expires: new Date("2031-01-01T00:00:00Z"),
      domain: "example.test",
      partitioned: true,
    });

    expect(cookieHeaders(set)).toEqual([
      "session=abc%20123; Path=/; Domain=example.test; Max-Age=60; Expires=Wed, 01 Jan 2031 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Partitioned",
    ]);
  });

  test("keeps every cookie as its own header", () => {
    const set = settings();
    writeCookie(set, "first", "1");
    writeCookie(set, "second", "2");

    expect(cookieHeaders(set)).toEqual(["first=1", "second=2"]);
  });

  test("appends to a cookie header a caller wrote", () => {
    const set = settings();
    set.headers["set-cookie"] = "manual=1";
    writeCookie(set, "session", "abc");

    expect(cookieHeaders(set)).toEqual(["manual=1", "session=abc"]);
  });

  test("clearCookie expires the value", () => {
    const set = settings();
    clearCookie(set, "session", { path: "/" });

    expect(cookieHeaders(set)).toEqual([
      "session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
  });

  test("refuses a name that is not a token", () => {
    expect(() => writeCookie(settings(), "not a name", "1")).toThrow(TypeError);
  });

  test("refuses an unknown same-site policy", () => {
    expect(() =>
      writeCookie(settings(), "session", "1", { sameSite: "sometimes" as never }),
    ).toThrow(TypeError);
  });
});

@Controller("session")
class SessionController {
  @Get("start")
  start(context: RouteContext): string {
    writeCookie(context.set, "first", "1", { httpOnly: true });
    writeCookie(context.set, "second", "2");
    return "started";
  }
}

@Module({ controllers: [SessionController] })
class CookieModule {}

test("answers with one header per written cookie", async () => {
  const application = await createPlatformFactory(fakeHost()).create(CookieModule, {
    logger: false,
  });

  try {
    const response = await application.handle(new Request("http://localhost/session/start"));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(["first=1; HttpOnly", "second=2"]);
  } finally {
    await application.close();
  }
});
