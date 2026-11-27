import { describe, expect, test } from "bun:test";
import { type RouteContext } from "../interfaces/route-schema.interface.ts";
import { clearCookie, writeCookie } from "./cookies.ts";

function fakeContext(): RouteContext {
  return {
    set: { headers: {} },
  } as unknown as RouteContext;
}

describe("cookies", () => {
  test("writes cookie defaults and attributes into context.set.headers", () => {
    const context = fakeContext();
    writeCookie(context.set, "session", "abc", { httpOnly: true, sameSite: "lax", maxAge: 60 });
    expect(context.set.headers["set-cookie"]).toEqual([
      "session=abc; Max-Age=60; HttpOnly; SameSite=Lax",
    ]);
  });

  test("appends multiple cookies and clears cookies with Max-Age=0", () => {
    const context = fakeContext();
    writeCookie(context.set, "a", "1");
    writeCookie(context.set, "b", "2");
    clearCookie(context.set, "a");
    expect(context.set.headers["set-cookie"]).toEqual([
      "a=1",
      "b=2",
      "a=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
  });

  test("serializes domain, secure, partitioned, and strict/none sameSite attributes", () => {
    const context = fakeContext();
    writeCookie(context.set, "prefs", "dark", {
      path: "/app",
      domain: "example.com",
      secure: true,
      partitioned: true,
      sameSite: "strict",
    });
    writeCookie(context.set, "cross", "1", { sameSite: "none" });
    expect(context.set.headers["set-cookie"]).toEqual([
      "prefs=dark; Path=/app; Domain=example.com; Secure; SameSite=Strict; Partitioned",
      "cross=1; SameSite=None",
    ]);
  });

  test("rejects invalid cookie names and invalid sameSite policies with TypeError", () => {
    const context = fakeContext();
    expect(() => writeCookie(context.set, "bad name", "1")).toThrow(TypeError);
    expect(() => writeCookie(context.set, "ok", "1", { sameSite: "invalid" as "lax" })).toThrow(
      TypeError,
    );
  });
});
