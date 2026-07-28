import { expect, test } from "bun:test";
import type { LoggerService } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

function createRecordingLogger(): { logger: LoggerService; lines: string[] } {
  const lines: string[] = [];
  const record = (message: unknown, context?: string) => {
    lines.push(`${context ?? "-"}: ${String(message)}`);
  };

  return {
    lines,
    logger: {
      log: record,
      error: record,
      warn: record,
      debug: record,
      verbose: record,
      fatal: record,
    } as LoggerService,
  };
}

test("prints nothing when logging is disabled", async () => {
  const { logger, lines } = createRecordingLogger();
  const application = await AponiaFactory.create(AppModule, { logger: false });
  await application.close();

  expect(lines).toBeEmpty();
  expect(logger).toBeDefined();
});

test("reports module initialization and route mapping to a custom logger", async () => {
  const { logger, lines } = createRecordingLogger();
  const application = await AponiaFactory.create(AppModule, { logger });
  await application.close();

  expect(lines.some((line) => line.startsWith("InstanceLoader:"))).toBe(true);
  expect(lines.some((line) => line.startsWith("RoutesResolver:"))).toBe(true);
  expect(lines.some((line) => line.includes("Mapped {/settings, GET} route"))).toBe(true);
});

test("names every mounted controller once", async () => {
  const { logger, lines } = createRecordingLogger();
  const application = await AponiaFactory.create(AppModule, { logger });
  await application.close();

  const resolved = lines.filter((line) => line.startsWith("RoutesResolver:"));

  expect(resolved).toHaveLength(new Set(resolved).size);
});
