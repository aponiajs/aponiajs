import { expect, test } from "bun:test";
import { Module, defineConfiguration } from "@aponiajs/common";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { z } from "zod";
import { CronModule, CronScheduler, type CronConfiguration } from "./index.ts";

function createAppModule() {
  const CronConfig = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          jobs: [{ name: "ticker", pattern: "*/5 * * * * *", run: (): void => {} }],
        }) satisfies CronConfiguration,
    ),
    "cron.platform",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class AppModule {}

  return AppModule;
}

// The registration is providers and a lifecycle hook, with no native plugin, so
// a boot on any platform starts the same jobs and stops them the same way.
test("starts and stops the scheduler on hono", async () => {
  const application = await createPlatformFactory(honoAdapter()).create(createAppModule(), {
    logger: false,
  });

  try {
    expect(application.get(CronScheduler).scheduled).toEqual(["ticker"]);
  } finally {
    await application.close();
  }

  expect(application.get(CronScheduler).scheduled).toEqual([]);
});

test("starts and stops the scheduler on h3", async () => {
  const application = await createPlatformFactory(h3Adapter()).create(createAppModule(), {
    logger: false,
  });

  try {
    expect(application.get(CronScheduler).scheduled).toEqual(["ticker"]);
  } finally {
    await application.close();
  }

  expect(application.get(CronScheduler).scheduled).toEqual([]);
});
