import { expect, test } from "bun:test";
import fc from "fast-check";
import { joinPaths } from "../src/routing/route-compiler.ts";

const segment = fc.stringMatching(/^[a-z][a-z0-9:-]{0,10}$/);

test("joining two segments yields one canonical path", () => {
  fc.assert(
    fc.property(segment, segment, (controllerPath, routePath) => {
      const joined = joinPaths(`/${controllerPath}/`, `/${routePath}/`);

      expect(joined).toBe(`/${controllerPath}/${routePath}`);
    }),
  );
});

test("a route that declares no path keeps the controller path", () => {
  fc.assert(
    fc.property(segment, (controllerPath) => {
      expect(joinPaths(`/${controllerPath}`, "")).toBe(`/${controllerPath}`);
      expect(joinPaths(`/${controllerPath}`, "/")).toBe(`/${controllerPath}`);
    }),
  );
});

test("two empty paths are the root", () => {
  expect(joinPaths("", "")).toBe("/");
  expect(joinPaths("/", "///")).toBe("/");
});
