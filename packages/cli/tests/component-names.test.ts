import { expect, test } from "bun:test";
import { createComponentNames, normalizeNameSegments } from "../src/generation/component-names.ts";

test("rejects names whose segments carry no letters", () => {
  expect(() => createComponentNames("")).toThrow(
    "Generated names must contain letters and use kebab-case paths.",
  );
  expect(() => createComponentNames("   ")).toThrow(
    "Generated names must contain letters and use kebab-case paths.",
  );
  expect(() => createComponentNames(".")).toThrow(
    "Generated names must contain letters and use kebab-case paths.",
  );
  expect(() => createComponentNames("./users")).toThrow(
    "Generated names must contain letters and use kebab-case paths.",
  );
  expect(() => createComponentNames("users/./list")).toThrow(
    "Generated names must contain letters and use kebab-case paths.",
  );
});

test("rejects absolute and traversing names before any normalization", () => {
  const traversalMessage = "Generated names must be relative and cannot contain parent traversal.";

  expect(() => createComponentNames("/")).toThrow(traversalMessage);
  expect(() => createComponentNames("//users")).toThrow(traversalMessage);
  expect(() => createComponentNames("..")).toThrow(traversalMessage);
  expect(() => createComponentNames("a/../b")).toThrow(traversalMessage);
});

test("accepts kebab-case, PascalCase, snake_case, and backslash-separated names", () => {
  expect(normalizeNameSegments("users//")).toEqual(["users"]);
  expect(normalizeNameSegments("users/")).toEqual(["users"]);
  expect(normalizeNameSegments("admin\\users")).toEqual(["admin", "users"]);
  expect(normalizeNameSegments("user_profile")).toEqual(["user-profile"]);
  expect(createComponentNames("Users")).toEqual(createComponentNames("users"));
  expect(createComponentNames("admin\\users")).toEqual(createComponentNames("admin/users"));
});

test("keeps digits after the first letter in a name", () => {
  expect(createComponentNames("Users2")).toEqual({
    fileName: "users2",
    className: "Users2",
    propertyName: "users2",
    singularFileName: "users2",
    singularClassName: "Users2",
    routePath: "users2",
  });
  expect(normalizeNameSegments("v2/users")).toEqual(["v2", "users"]);
});

test("derives a single-letter name and an irregular singular through inflection", () => {
  expect(createComponentNames("X")).toEqual({
    fileName: "x",
    className: "X",
    propertyName: "x",
    singularFileName: "x",
    singularClassName: "X",
    routePath: "x",
  });
  expect(createComponentNames("data").singularFileName).toBe("datum");
  expect(createComponentNames("blog-posts").singularFileName).toBe("blog-post");
});
