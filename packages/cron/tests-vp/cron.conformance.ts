import {
  AponiaError,
  Module,
  defineConfiguration,
  type ConfigurationToken,
} from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { z } from "zod";
import { CronModule, CronScheduler } from "../src/index.ts";
import type { CronConfiguration, CronJob, CronJobContext, CronJobOptions } from "../src/index.ts";
import type { CronModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The compile-time half of this lane: the contract a consumer writes against.
 *
 * `CronJobOptions` is the assertion that matters most. It is derived from
 * `@elysia/cron`'s own `CronConfig` rather than restated here, so naming every
 * option croner accepts is what pins the derivation: a release that adds, renames,
 * or drops an option moves this type, and a hand-written copy that stopped
 * matching the dependency fails `bun run check` instead of shipping.
 *
 * The named properties are the dependency's, so a croner release that renames one
 * fails here for a reason, not by accident: it is the moment a change in a package
 * this one wraps becomes visible before an application meets it.
 */
type CronContractAssertions = [
  Expect<
    Equals<
      keyof CronJobOptions,
      | "paused"
      | "kill"
      | "catch"
      | "unref"
      | "maxRuns"
      | "interval"
      | "protect"
      | "startAt"
      | "stopAt"
      | "timezone"
      | "utcOffset"
      | "legacyMode"
      | "context"
    >
  >,
  Expect<Equals<keyof CronModuleOptions, "configuration" | "source" | "key">>,
  Expect<Equals<CronModuleOptions["configuration"], ConfigurationToken<CronConfiguration>>>,
  Expect<Equals<CronModuleOptions["source"], Readonly<Record<string, unknown>> | undefined>>,
  Expect<Equals<CronConfiguration["jobs"], readonly CronJob[]>>,
  Expect<Equals<CronJob["options"], CronJobOptions | undefined>>,
  Expect<Equals<CronJobContext["options"], CronJobOptions>>,
  // A job whose options are narrower than the engine's is the ordinary
  // declaration, and this is the assertion that fails when `run` stops being
  // checked bivariantly: with a function-typed property the parameter is
  // contravariant and this assignment is refused.
  Expect<Extract<CronJob<{ timezone: string }>, CronJob> extends never ? false : true>,
  // The scheduler reaches an application through the module's exports, so its
  // reads stay the published ones.
  Expect<Equals<CronScheduler["jobs"], readonly CronJob[]>>,
  Expect<Equals<CronScheduler["scheduled"], readonly string[]>>,
  Expect<Equals<CronScheduler["onApplicationShutdown"], () => void>>,
];

/** The barrel as a consumer's `import` sees it. */
type CronBarrel = typeof import("../src/index.ts");

/**
 * The exports this package must keep, named so a renamed or dropped one fails
 * this lane rather than an application.
 */
type CronBarrelAssertions = [
  Expect<
    Equals<
      Extract<keyof CronBarrel, "CronModule" | "CronScheduler">,
      "CronModule" | "CronScheduler"
    >
  >,
];

/**
 * A pattern that fires on every second boundary. Five fields would make every case
 * here wait for a minute, which no lane should spend.
 */
const secondPattern = "*/1 * * * * *";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate() && Date.now() < deadline) {
    await sleep(20);
  }

  return predicate();
}

/**
 * A configuration value of the shape a JavaScript caller can produce: the type is
 * this package's contract, and the guard is what makes it true at runtime.
 */
function declaredValue(value: unknown): CronConfiguration {
  return value as CronConfiguration;
}

const assertion: CronContractAssertions = Array.from(
  { length: 11 },
  () => true,
) as CronContractAssertions;

test("keeps the contract assertions referenced", () => {
  expect(assertion).toHaveLength(11);
});

test("mounts a scheduler a module registration declares", async () => {
  let ticks = 0;

  const CronConfig = defineConfiguration(
    z.object({}).transform(() => ({
      jobs: [
        {
          name: "counter",
          pattern: secondPattern,
          options: { maxRuns: 1 },
          run: (): void => {
            ticks += 1;
          },
        },
      ],
    })),
    "cron.conformance.counter",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    expect(await waitUntil(() => ticks > 0)).toBe(true);
    expect(application.get(CronScheduler).jobs.map((job) => job.name)).toEqual(["counter"]);
    // The module declares the configuration and exports it, so an application
    // reads back the value the scheduler scheduled.
    expect(application.get(CronConfig).jobs.map((job) => job.name)).toEqual(["counter"]);
  } finally {
    await application.close();
  }

  expect(ticks).toBe(1);
}, 10_000);

test("hands a job the options its validated configuration parsed", async () => {
  const contexts: CronJobContext[] = [];

  const CronConfig = defineConfiguration(
    z.object({ MAX_RUNS: z.coerce.number().int().positive() }).transform(({ MAX_RUNS }) => ({
      jobs: [
        {
          name: "reader",
          pattern: secondPattern,
          options: { maxRuns: MAX_RUNS },
          run: (context: CronJobContext): void => {
            contexts.push(context);
          },
        },
      ],
    })),
    "cron.conformance.reader",
  );

  const registration = CronModule.register({
    configuration: CronConfig,
    source: { MAX_RUNS: "1" },
  });

  @Module({ imports: [registration] })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  try {
    expect(await waitUntil(() => contexts.length > 0)).toBe(true);
  } finally {
    await application.close();
  }

  // A number where the source held the string `"1"` is the schema's parse, and the
  // job receiving it is what "the options come from the validated configuration"
  // means at the point a caller can observe it.
  expect(contexts[0]).toEqual({
    name: "reader",
    pattern: secondPattern,
    options: { maxRuns: 1 },
  });
}, 10_000);

test("stops the scheduler when the application closes", async () => {
  let ticks = 0;

  const CronConfig = defineConfiguration(
    z.object({}).transform(() => ({
      jobs: [
        {
          name: "ticker",
          pattern: secondPattern,
          run: (): void => {
            ticks += 1;
          },
        },
      ],
    })),
    "cron.conformance.ticker",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class ConformanceModule {}

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });
  const scheduler = application.get(CronScheduler);

  try {
    expect(await waitUntil(() => ticks > 0)).toBe(true);
  } finally {
    await application.close();
  }

  const ticksAtClose = ticks;
  await sleep(2400);

  expect(ticks).toBe(ticksAtClose);
  expect(scheduler.scheduled).toEqual([]);
}, 10_000);

test("refuses a boot whose configuration is invalid, with the framework's error", async () => {
  const CronConfig = defineConfiguration(
    z.object({ PATTERN: z.string().min(1) }).transform(({ PATTERN }) => ({
      jobs: [{ name: "never", pattern: PATTERN, run: (): void => {} }],
    })),
    "cron.conformance.required",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class ConformanceModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(ConformanceModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect((failure as AponiaError).code).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({
    configuration: "cron.conformance.required",
  });
});

test("refuses a job list only a runtime can produce", async () => {
  const CronConfig = defineConfiguration(
    z
      .object({})
      .transform(() => declaredValue({ jobs: [{ name: "job", pattern: "", run: () => {} }] })),
    "cron.conformance.malformed",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class ConformanceModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(ConformanceModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect((failure as AponiaError).details.issues).toEqual([
    "jobs[0].pattern must be a non-empty string: a cron expression, an ISO 8601 time, or a date",
  ]);
});

// A registration is a `DynamicModule`, which is the value an application's
// `imports` accepts. Held here so this lane compiles the shape without booting.
const registration = CronModule.register({
  configuration: defineConfiguration(
    z.object({}).transform(() => declaredValue({ jobs: [] })),
    "cron.conformance.empty",
  ),
  source: {},
});

test("the registration is a module an application import accepts", () => {
  expect(registration.module).toBeDefined();
  expect(registration.providers?.length).toBeGreaterThan(0);

  const assertions: CronBarrelAssertions = [true];
  expect(assertions).toHaveLength(1);
});
