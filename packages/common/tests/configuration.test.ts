import { describe, expect, test } from "bun:test";
import { z } from "zod";
// Relative, like every other test in this directory: importing the package by
// its own name from inside it resolves to `dist/`, which CI never builds.
import { defineConfiguration } from "../src/index.ts";

describe("defineConfiguration", () => {
  test("carries the schema it was given", () => {
    const schema = z.object({ port: z.coerce.number().int().positive() });

    const token = defineConfiguration(schema, "app.config");

    expect(token.schema).toBe(schema);
  });

  test("is a token the graph can key on", () => {
    const token = defineConfiguration(z.object({ port: z.number() }), "app.config");

    expect(typeof token.id).toBe("symbol");
    expect(token.description).toBe("app.config");
  });

  test("is frozen, so a declaration cannot be edited after it is made", () => {
    const token = defineConfiguration(z.object({ port: z.number() }));

    expect(Object.isFrozen(token)).toBe(true);
  });

  test("names itself when the caller does not", () => {
    const token = defineConfiguration(z.object({ port: z.number() }));

    expect(token.description).toBe("configuration");
  });
});
