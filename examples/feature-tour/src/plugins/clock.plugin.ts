import { defineElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

/**
 * Use case: a native Elysia plugin exported as a value and a same-named type,
 * so it mounts through `imports` and types a handler without `typeof`.
 */
export const clock = defineElysiaPlugin(
  new Elysia({ name: "clock" })
    .decorate("now", () => new Date().toISOString())
    .state("requests", 0)
    .derive({ as: "global" }, () => ({ traceId: crypto.randomUUID() })),
  { key: "clock" },
);
export type clock = typeof clock;
