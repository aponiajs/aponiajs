import { describe, expect, test } from "bun:test";
import { Controller } from "@aponiajs/common";
import {
  isRouteExcluded,
  matchPath,
  matchRouteTarget,
  normalizePath,
} from "../src/middleware/middleware-matcher.ts";

@Controller("annotated")
class AnnotatedController {}

class PlainClass {}

describe("middleware-matcher", () => {
  test("normalizePath handles edge cases", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("users")).toBe("/users");
    expect(normalizePath("/users/")).toBe("/users");
  });

  test("matchPath handles wildcard, segment patterns, and mismatches", () => {
    expect(matchPath("/*", "/any")).toBe(true);
    expect(matchPath("*", "/any")).toBe(true);
    expect(matchPath("/admin/*", "/admin/dashboard")).toBe(true);
    expect(matchPath("/admin/*", "/other")).toBe(false);
    expect(matchPath("/exact", "/exact")).toBe(true);
    expect(matchPath("/exact", "/exact/child")).toBe(true);
    expect(matchPath("/users/:id", "/users/42")).toBe(true);
    expect(matchPath("/users/:id", "/users/42/sub")).toBe(false);
    expect(matchPath("/a/b/c", "/a/x/c")).toBe(false);
  });

  test("matchRouteTarget matches strings, controllers, and method descriptors", () => {
    expect(matchRouteTarget("/api/*", "/api/v1", "GET")).toBe(true);
    expect(matchRouteTarget(AnnotatedController, "/annotated/list", "GET")).toBe(true);
    expect(matchRouteTarget(PlainClass, "/annotated/list", "GET")).toBe(false);
    expect(matchRouteTarget({ path: "/orders", method: "POST" }, "/orders", "POST")).toBe(true);
    expect(matchRouteTarget({ path: "/orders", method: "POST" }, "/orders", "GET")).toBe(false);
    expect(matchRouteTarget(123 as never, "/orders", "GET")).toBe(false);
  });

  test("isRouteExcluded handles string and object exclusion rules", () => {
    expect(isRouteExcluded(["/public"], "/public", "GET")).toBe(true);
    expect(isRouteExcluded([{ path: "/health", method: "GET" }], "/health", "GET")).toBe(true);
    expect(isRouteExcluded([{ path: "/health", method: "GET" }], "/health", "POST")).toBe(false);
    expect(isRouteExcluded([], "/test", "GET")).toBe(false);
  });
});
