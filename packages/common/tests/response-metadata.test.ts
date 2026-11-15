import { describe, expect, test } from "bun:test";
import {
  All,
  Header,
  HttpCode,
  Ip,
  getHttpCode,
  getResponseHeaders,
  getRouteMetadata,
  getRouteParameterMetadata,
} from "../src/index.ts";

class SampleController {
  @All("webhook")
  @Header("cache-control", "no-store")
  @Header("x-list", ["a", "b"])
  @HttpCode(202)
  handle(@Ip() ip: string | undefined) {
    return { ip };
  }
}

class ChildController extends SampleController {}

describe("response metadata decorators", () => {
  test("records the ALL method on the route", () => {
    expect(getRouteMetadata(SampleController)).toEqual([
      expect.objectContaining({ method: "ALL", path: "webhook", propertyKey: "handle" }),
    ]);
  });

  test("merges repeated header declarations, frozen", () => {
    const headers = getResponseHeaders(SampleController, "handle");

    expect(headers).toEqual({ "cache-control": "no-store", "x-list": ["a", "b"] });
    expect(Object.isFrozen(headers)).toBe(true);
    expect(Object.isFrozen(headers?.["x-list"])).toBe(true);
  });

  test("records the declared status", () => {
    expect(getHttpCode(SampleController, "handle")).toBe(202);
    expect(getHttpCode(SampleController, "missing")).toBeUndefined();
    expect(getResponseHeaders(SampleController, "missing")).toBeUndefined();
  });

  test("records the IP parameter binding", () => {
    expect(getRouteParameterMetadata(SampleController, "handle")).toEqual([
      expect.objectContaining({ kind: "ip", index: 0 }),
    ]);
  });

  test("a subclass inherits no response metadata", () => {
    expect(getResponseHeaders(ChildController, "handle")).toBeUndefined();
    expect(getHttpCode(ChildController, "handle")).toBeUndefined();
  });

  test("refuses malformed declarations at the decoration site", () => {
    expect(() => Header("", "value")).toThrow(TypeError);
    expect(() => Header("x", { value: "no" } as unknown as string)).toThrow(TypeError);
    expect(() => HttpCode(99)).toThrow(TypeError);
    expect(() => HttpCode(600)).toThrow(TypeError);
    expect(() => HttpCode(200.5)).toThrow(TypeError);
  });
});
