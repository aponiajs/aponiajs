import { defineElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

/**
 * Exported as a value and a same-named type, so it mounts through `imports`
 * and types a handler without `typeof`.
 */
export const clock = defineElysiaPlugin(
  new Elysia({ name: "clock" })
    .decorate("now", () => new Date().toISOString())
    .state("requests", 0)
    .derive("global", () => ({ traceId: crypto.randomUUID() }))
    .derive("plugin", () => ({ scope: "request" }))
    .derive(() => ({ pluginOnly: "never leaves the plugin" })),
  { key: "clock" },
);
export type clock = typeof clock;
