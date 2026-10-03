import { expect, test } from "bun:test";
import { AponiaError, Module, defineConfiguration, type AponiaErrorCode } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { z } from "zod";
import { CronModule, CronScheduler } from "../src/index.ts";
import type { CronConfiguration, CronJobContext } from "../src/index.ts";

/**
 * A pattern that fires on every second boundary, so a case observes a real tick
 * in under a second rather than sleeping through a minute the way a five-field
 * expression would force.
 */
const secondPattern = "*/1 * * * * *";

/**
 * The timeouts every waiting case runs under.
 *
 * Bun's default is five seconds, and the case that proves a stopped job stays
 * stopped spends its own wait on top of the tick it waited for, so the budget has
 * to be named rather than inherited.
 */
const waitBudgetMs = 3000;
const caseTimeoutMs = 10_000;

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Waits for a job to do something, rather than sleeping a fixed span and hoping.
 *
 * A fixed sleep long enough for the engine's next tick would be a sleep long
 * enough for two on a loaded machine, and a case that asserted an exact tick
 * count after one would fail for a reason that has nothing to do with this
 * package. Polling the fact the case is about keeps the assertion the case's own.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = waitBudgetMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate() && Date.now() < deadline) {
    await sleep(20);
  }

  expect(predicate(), "the job never ran").toBe(true);
}

/**
 * A configuration value of the shape a JavaScript caller can produce.
 *
 * `CronConfiguration` says `jobs` holds jobs, and the type is the contract rather
 * than a guarantee: a schema's transform is arbitrary JavaScript, so a value that
 * is not a list of jobs reaches this package at runtime however the declaration
 * reads. The cast is where a case states that, and the guard under test is what
 * has to make the contract true afterwards — so the case builds the value through
 * here rather than disabling a check at the assertion.
 */
function declaredValue(value: unknown): CronConfiguration {
  return value as CronConfiguration;
}

test(
  "runs a job an application declares through a module registration",
  async (): Promise<void> => {
    let ticks = 0;

    const CronConfig = defineConfiguration(
      z
        .object({ SECOND_PATTERN: z.string().min(1).default(secondPattern) })
        .transform(({ SECOND_PATTERN }) => ({
          jobs: [
            {
              name: "counter",
              pattern: SECOND_PATTERN,
              options: { maxRuns: 1 },
              run: (): void => {
                ticks += 1;
              },
            },
          ],
        })),
      "cron.counter",
    );

    @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    try {
      await waitUntil(() => ticks > 0);
    } finally {
      await application.close();
    }

    // `maxRuns` is the engine's, forwarded untouched: the job ran once and the
    // engine retired it, which is also what keeps this case from leaving a timer
    // behind for the next one.
    expect(ticks).toBe(1);
    expect(application.get(CronScheduler).jobs.map((job) => job.name)).toEqual(["counter"]);
    // The module declares the configuration and exports it, so the application
    // that mounted it reads back the same value the scheduler scheduled rather
    // than declaring the token a second time.
    expect(application.get(CronConfig).jobs.map((job) => job.name)).toEqual(["counter"]);
  },
  caseTimeoutMs,
);

test(
  "hands a job the options its validated configuration parsed",
  async (): Promise<void> => {
    const contexts: CronJobContext[] = [];

    const CronConfig = defineConfiguration(
      z
        .object({
          PATTERN: z.string().min(1),
          MAX_RUNS: z.coerce.number().int().positive(),
          TIMEZONE: z.string().min(1),
        })
        .transform(({ PATTERN, MAX_RUNS, TIMEZONE }) => ({
          jobs: [
            {
              name: "reader",
              pattern: PATTERN,
              options: { maxRuns: MAX_RUNS, timezone: TIMEZONE },
              run: (context: CronJobContext): void => {
                contexts.push(context);
              },
            },
          ],
        })),
      "cron.reader",
    );

    @Module({
      imports: [
        CronModule.register({
          configuration: CronConfig,
          source: { PATTERN: secondPattern, MAX_RUNS: "1", TIMEZONE: "UTC" },
        }),
      ],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    try {
      await waitUntil(() => contexts.length > 0);

      // Read from the boot rather than from the declaration, so a scheduler that
      // never reached the engine cannot pass on the strength of its own options.
      expect(application.get(CronScheduler).scheduled).toEqual(["reader"]);
    } finally {
      await application.close();
    }

    const context = contexts[0] as CronJobContext;

    expect(context).toEqual({
      name: "reader",
      pattern: secondPattern,
      // `MAX_RUNS` arrived as the string `"1"`, so a number here is the schema's
      // parse rather than the source's raw value: the job is configured with what
      // the validation produced, not with what the environment held.
      options: { maxRuns: 1, timezone: "UTC" },
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(contexts).toHaveLength(1);
  },
  caseTimeoutMs,
);

test(
  "stops every job when the application closes",
  async (): Promise<void> => {
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
      "cron.ticker",
    );

    @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    const scheduler = application.get(CronScheduler);

    try {
      await waitUntil(() => ticks > 0);
    } finally {
      await application.close();
    }

    const ticksAtClose = ticks;

    // Long enough for two more boundaries on the pattern above, which is what
    // makes the assertion a claim about the stop rather than about the wait.
    await sleep(2400);

    expect(ticks).toBe(ticksAtClose);
    expect(scheduler.scheduled).toEqual([]);
  },
  caseTimeoutMs,
);

test(
  "gives each boot its own scheduler, and stopping one leaves the other alone",
  async (): Promise<void> => {
    const CronConfig = defineConfiguration(
      z.object({}).transform(() => ({
        jobs: [{ name: "ticker", pattern: secondPattern, run: (): void => {} }],
      })),
      "cron.shared",
    );
    const registration = CronModule.register({ configuration: CronConfig, source: {} });

    @Module({ imports: [registration] })
    class AppModule {}

    const first = await AponiaFactory.create(AppModule, { logger: false });
    const second = await AponiaFactory.create(AppModule, { logger: false });

    try {
      const firstScheduler = first.get(CronScheduler);
      const secondScheduler = second.get(CronScheduler);

      // One registration, two boot containers: the module's provider factory runs
      // once per container, so the handles one application holds are not the
      // other's. A module-level value would make these the same object, and
      // closing either application would stop both.
      expect(firstScheduler).not.toBe(secondScheduler);
      expect(secondScheduler.scheduled).toEqual(["ticker"]);

      await first.close();

      expect(firstScheduler.scheduled).toEqual([]);
      expect(secondScheduler.scheduled).toEqual(["ticker"]);
    } finally {
      await second.close();
    }
  },
  caseTimeoutMs,
);

test("refuses a boot whose configuration the schema rejects", async (): Promise<void> => {
  const CronConfig = defineConfiguration(
    z.object({ PATTERN: z.string().min(1) }).transform(({ PATTERN }) => ({
      jobs: [{ name: "never", pattern: PATTERN, run: (): void => {} }],
    })),
    "cron.required",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "cron.required" });
  expect((failure as AponiaError).details.issues).toHaveLength(1);
});

test("refuses a job a configuration declares that no schema could have caught", async (): Promise<void> => {
  const CronConfig = defineConfiguration(
    z
      .object({})
      .transform(() => declaredValue({ jobs: [{ name: "   ", pattern: "", run: undefined }] })),
    "cron.malformed",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details).toMatchObject({ configuration: "cron.malformed" });

  // Every malformed field of the one job, not just the first: a boot that names
  // one problem at a time is a boot a maintainer runs three times.
  expect((failure as AponiaError).details.issues).toEqual([
    "jobs[0].name must be a non-empty string",
    "jobs[0].pattern must be a non-empty string: a cron expression, an ISO 8601 time, or a date",
    "jobs[0].run must be a function",
  ]);
});

test("refuses a configuration whose value states no job list", async (): Promise<void> => {
  const CronConfig = defineConfiguration(
    z.object({}).transform(() => declaredValue({ jobs: "not a list" })),
    "cron.notalist",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
  expect((failure as AponiaError).details.issues).toEqual(['"jobs" must be an array of jobs']);
});

test("mounts a scheduler that was declared with nothing to schedule", async (): Promise<void> => {
  const CronConfig = defineConfiguration(
    z.object({}).transform(() => declaredValue({ jobs: [] })),
    "cron.empty",
  );

  @Module({ imports: [CronModule.register({ configuration: CronConfig, source: {} })] })
  class AppModule {}

  // An empty registration is a module with nothing to schedule, which is the case
  // the guard must let through rather than refuse: a plugin that ends the boot
  // over a job list nobody wrote is a plugin an application cannot turn off.
  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const scheduler = application.get(CronScheduler);

    expect(scheduler.jobs).toEqual([]);
    expect(scheduler.scheduled).toEqual([]);
  } finally {
    await application.close();
  }
});

test("refuses two registrations that share a key", async (): Promise<void> => {
  const first = CronModule.register({
    configuration: defineConfiguration(
      z.object({}).transform(() => declaredValue({ jobs: [] })),
      "cron.duplicate.first",
    ),
    source: {},
  });
  const second = CronModule.register({
    configuration: defineConfiguration(
      z.object({}).transform(() => declaredValue({ jobs: [] })),
      "cron.duplicate.second",
    ),
    source: {},
  });

  @Module({ imports: [first, second] })
  class AppModule {}

  let failure: unknown;

  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  // The key is the module's identity, so two registrations that share one are not
  // two modules: the graph refuses the boot rather than mounting one of them and
  // dropping the other, which would silently schedule half of what was declared.
  expect(codeOf(failure)).toBe("DUPLICATE_MODULE");
  expect((failure as AponiaError).details).toMatchObject({ module: "PluginModule[cron]" });
});

test(
  "runs two registrations under distinct keys, and reads neither by class",
  async (): Promise<void> => {
    let firstTicks = 0;
    let secondTicks = 0;

    const first = CronModule.register({
      configuration: defineConfiguration(
        z.object({}).transform(() => ({
          jobs: [
            {
              name: "first",
              pattern: secondPattern,
              options: { maxRuns: 1 },
              run: (): void => {
                firstTicks += 1;
              },
            },
          ],
        })),
        "cron.distinct.first",
      ),
      source: {},
      key: "cron-first",
    });
    const second = CronModule.register({
      configuration: defineConfiguration(
        z.object({}).transform(() => ({
          jobs: [
            {
              name: "second",
              pattern: secondPattern,
              options: { maxRuns: 1 },
              run: (): void => {
                secondTicks += 1;
              },
            },
          ],
        })),
        "cron.distinct.second",
      ),
      source: {},
      key: "cron-second",
    });

    @Module({ imports: [first, second] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    try {
      await waitUntil(() => firstTicks > 0 && secondTicks > 0);

      // Both registrations mount and both run, so a distinct key is a thing an
      // application can do. What it cannot do is read one back: the two schedulers
      // are one token, and the graph names that rather than picking a winner.
      let failure: unknown;

      try {
        application.get(CronScheduler);
      } catch (error) {
        failure = error;
      }

      expect(codeOf(failure)).toBe("AMBIGUOUS_PROVIDER");
    } finally {
      await application.close();
    }

    const ticksAtClose = firstTicks + secondTicks;

    await sleep(2400);

    // Closing stops both. A lifecycle that stopped only the resolved one would leave
    // the other ticking after the application was gone.
    expect(firstTicks + secondTicks).toBe(ticksAtClose);
  },
  caseTimeoutMs,
);
