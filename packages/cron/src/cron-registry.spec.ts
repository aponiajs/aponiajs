import { describe, expect, test } from "bun:test";
import { AponiaError, Module, createToken, defineConfiguration } from "@aponiajs/common";
import type { ConfigurationToken } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import type { Cron as CronerJob } from "croner";
import { z } from "zod";
import {
  Cron,
  CronModule,
  CronScheduler,
  Interval,
  SchedulerRegistry,
  Timeout,
  type CronConfiguration,
  type CronJob,
  type ScheduleTimer,
} from "./index.ts";
import { readCronJobs } from "./scheduler/cron-scheduler.ts";
import {
  SCHEDULER_TYPE,
  SCHEDULE_CRON_OPTIONS,
  SCHEDULE_INTERVAL_OPTIONS,
  SCHEDULE_TIMEOUT_OPTIONS,
} from "./cron.constants.ts";
import { ScheduleExplorer } from "./scheduler/schedule.explorer.ts";
import { SchedulerOrchestrator } from "./scheduler/scheduler-orchestrator.ts";
import { SchedulerType } from "./cron.constants.ts";

class FakeTimer implements ScheduleTimer {
  readonly timeouts: { readonly handler: () => void; readonly delayMs: number }[] = [];
  readonly intervals: { readonly handler: () => void; readonly delayMs: number }[] = [];
  readonly cleared: unknown[] = [];

  setTimeout(handler: () => void, delayMs: number): unknown {
    const handle = { handler, delayMs };
    this.timeouts.push(handle);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.cleared.push(handle);
  }

  setInterval(handler: () => void, delayMs: number): unknown {
    const handle = { handler, delayMs };
    this.intervals.push(handle);
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.cleared.push(handle);
  }
}

function fakeCron(stop: () => void = () => {}): CronerJob {
  return { stop } as unknown as CronerJob;
}

const configuration = defineConfiguration(
  z.object({}).transform(() => ({ jobs: [] })),
  "cron.registry.boot",
);

class ScheduledJobs {
  cronRuns = 0;
  intervalRuns = 0;
  timeoutRuns = 0;

  /** A non-function member, which the explorer must not try to schedule. */
  get computed(): number {
    return 1;
  }

  /** A method with no scheduler metadata, which the explorer must ignore. */
  untyped(): void {}

  @Cron("*/1 * * * * *", { name: "decorated-cron", disabled: true })
  tick(): void {
    this.cronRuns += 1;
  }

  @Interval("decorated-interval", 10)
  beat(): void {
    this.intervalRuns += 1;
  }

  @Timeout("decorated-timeout", 10)
  once(): void {
    this.timeoutRuns += 1;
  }
}

function explorerFor(
  instance: object,
  options: {
    readonly cronJobs?: boolean;
    readonly intervals?: boolean;
    readonly timeouts?: boolean;
  },
  orchestrator: SchedulerOrchestrator,
): ScheduleExplorer {
  const moduleRef = {
    get: (token: object) => {
      if (Object.getPrototypeOf(instance).constructor !== token) {
        throw new Error("not a provider of this boot");
      }
      return instance;
    },
    resolve: () => instance,
    create: () => instance,
    registerRequestByContextId: () => {},
  };
  return new ScheduleExplorer(options as never, orchestrator, moduleRef as never);
}

describe("SchedulerRegistry", () => {
  test("adds, reads, lists, and deletes every kind", () => {
    const timer = new FakeTimer();
    const registry = new SchedulerRegistry(timer);
    const job = fakeCron();

    registry.addCronJob("cron", job);
    registry.addInterval("interval", { kind: "interval" });
    registry.addTimeout("timeout", { kind: "timeout" });

    expect(registry.doesExist("cron", "cron")).toBe(true);
    expect(registry.doesExist("interval", "interval")).toBe(true);
    expect(registry.doesExist("timeout", "timeout")).toBe(true);
    expect(registry.doesExist("cron", "missing")).toBe(false);
    expect(registry.getCronJob("cron")).toBe(job);
    expect(registry.getCronJobs().size).toBe(1);
    expect(registry.getIntervals()).toEqual(["interval"]);
    expect(registry.getTimeouts()).toEqual(["timeout"]);

    registry.deleteCronJob("cron");
    registry.deleteInterval("interval");
    registry.deleteTimeout("timeout");

    expect(registry.getCronJobs().size).toBe(0);
    expect(timer.cleared).toHaveLength(2);
  });

  test("refuses duplicate names and missing lookups with a framework error", () => {
    const registry = new SchedulerRegistry(new FakeTimer());

    registry.addCronJob("cron", fakeCron());
    expect(() => registry.addCronJob("cron", fakeCron())).toThrow(AponiaError);
    expect(() => registry.getCronJob("missing")).toThrow(AponiaError);
    expect(() => registry.getInterval("missing")).toThrow(AponiaError);
    expect(() => registry.getTimeout("missing")).toThrow(AponiaError);
  });
});

describe("schedule decorators", () => {
  test("record their kind, name, and options", () => {
    const prototype = ScheduledJobs.prototype;
    const cron = Object.getOwnPropertyDescriptor(prototype, "tick")?.value as object;
    const interval = Object.getOwnPropertyDescriptor(prototype, "beat")?.value as object;
    const timeout = Object.getOwnPropertyDescriptor(prototype, "once")?.value as object;

    expect(Reflect.getMetadata("SCHEDULER_TYPE", cron)).toBe(SchedulerType.CRON);
    expect(Reflect.getMetadata("SCHEDULER_NAME", cron)).toBe("decorated-cron");
    expect(Reflect.getMetadata("SCHEDULE_CRON_OPTIONS", cron)).toMatchObject({
      cronTime: "*/1 * * * * *",
      name: "decorated-cron",
      disabled: true,
    });
    expect(Reflect.getMetadata("SCHEDULER_TYPE", interval)).toBe(SchedulerType.INTERVAL);
    expect(Reflect.getMetadata("SCHEDULER_NAME", interval)).toBe("decorated-interval");
    expect(Reflect.getMetadata("SCHEDULER_TYPE", timeout)).toBe(SchedulerType.TIMEOUT);
    expect(Reflect.getMetadata("SCHEDULER_NAME", timeout)).toBe("decorated-timeout");
  });

  test("refuse an empty name or a non-positive timeout at the decoration site", () => {
    expect(() => Cron("")).toThrow(TypeError);
    expect(() => Cron("*/1 * * * * *", { name: "" })).toThrow(TypeError);
    expect(() => Interval(0)).toThrow(TypeError);
    expect(() => Timeout("name", 0)).toThrow(TypeError);
  });

  test("the explorer mounts every kind on the orchestrator", () => {
    const timer = new FakeTimer();
    const registry = new SchedulerRegistry(timer);
    const orchestrator = new SchedulerOrchestrator(registry, timer);
    const jobs = new ScheduledJobs();

    explorerFor(jobs, {}, orchestrator).onModuleInit();
    orchestrator.onApplicationBootstrap();

    expect(timer.intervals).toHaveLength(1);
    expect(timer.timeouts).toHaveLength(1);
    expect(registry.doesExist("cron", "decorated-cron")).toBe(true);
    expect(registry.doesExist("interval", "decorated-interval")).toBe(true);
    expect(registry.doesExist("timeout", "decorated-timeout")).toBe(true);

    timer.intervals[0]!.handler();
    timer.timeouts[0]!.handler();
    expect(jobs.intervalRuns).toBe(1);
    expect(jobs.timeoutRuns).toBe(1);

    orchestrator.beforeApplicationShutdown();
    expect(registry.getCronJobs().size).toBe(0);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);
  });

  test("respects the module's per-kind switches", () => {
    const timer = new FakeTimer();
    const registry = new SchedulerRegistry(timer);
    const orchestrator = new SchedulerOrchestrator(registry, timer);

    explorerFor(
      new ScheduledJobs(),
      { cronJobs: false, intervals: false, timeouts: false },
      orchestrator,
    ).onModuleInit();
    orchestrator.onApplicationBootstrap();

    expect(timer.intervals).toHaveLength(0);
    expect(timer.timeouts).toHaveLength(0);
    expect(registry.getCronJobs().size).toBe(0);
  });

  test("a disabled cron is registered but not running", () => {
    const timer = new FakeTimer();
    const registry = new SchedulerRegistry(timer);
    const orchestrator = new SchedulerOrchestrator(registry, timer);
    const jobs = new ScheduledJobs();

    explorerFor(jobs, {}, orchestrator).onModuleInit();
    orchestrator.onApplicationBootstrap();

    const job = registry.getCronJob("decorated-cron");
    expect(job.isBusy()).toBe(false);
    expect(job.isStopped()).toBe(false);
    expect(jobs.cronRuns).toBe(0);
  });
});

describe("CronModule exposes the registry", () => {
  test("a boot provides and exports SchedulerRegistry", async () => {
    @Module({ imports: [CronModule.forRoot({ configuration, source: {} })] })
    class AppModule {}

    const application: AponiaApplication = await AponiaFactory.create(AppModule, {
      logger: false,
    });
    try {
      expect(application.get(SchedulerRegistry)).toBeInstanceOf(SchedulerRegistry);
    } finally {
      await application.close();
    }
  });
});

describe("scheduler registry duplicates", () => {
  test("refuses a duplicate interval and timeout name", () => {
    const registry = new SchedulerRegistry(new FakeTimer());

    registry.addInterval("interval", {});
    registry.addTimeout("timeout", {});
    expect(() => registry.addInterval("interval", {})).toThrow(AponiaError);
    expect(() => registry.addTimeout("timeout", {})).toThrow(AponiaError);

    try {
      registry.addInterval("interval", {});
    } catch (error) {
      expect((error as AponiaError).details).toEqual({
        schedulerType: "interval",
        name: "interval",
      });
    }
    try {
      registry.addTimeout("timeout", {});
    } catch (error) {
      expect((error as AponiaError).details).toEqual({ schedulerType: "timeout", name: "timeout" });
    }
  });
});

describe("schedule decorator refusals", () => {
  test("refuses an expression that is neither a string nor a date", () => {
    expect(() => Cron(42 as never)).toThrow(TypeError);
  });

  test("refuses a negative or fractional initial delay", () => {
    expect(() => Cron("*/1 * * * * *", { initialDelay: -1 })).toThrow(TypeError);
    expect(() => Cron("*/1 * * * * *", { initialDelay: 1.5 })).toThrow(TypeError);
  });

  test("refuses an empty interval or timeout name", () => {
    expect(() => Interval("", 10)).toThrow(TypeError);
    expect(() => Timeout("", 10)).toThrow(TypeError);
  });
});

describe("ScheduleExplorer metadata it cannot read", () => {
  test("skips a missing options record and a type it does not own", () => {
    const timer = new FakeTimer();
    const registry = new SchedulerRegistry(timer);
    const orchestrator = new SchedulerOrchestrator(registry, timer);
    const jobs = new ScheduledJobs();
    const cronMethod = Object.getOwnPropertyDescriptor(ScheduledJobs.prototype, "tick")
      ?.value as object;
    const intervalMethod = Object.getOwnPropertyDescriptor(ScheduledJobs.prototype, "beat")
      ?.value as object;
    const timeoutMethod = Object.getOwnPropertyDescriptor(ScheduledJobs.prototype, "once")
      ?.value as object;
    const untypedMethod = Object.getOwnPropertyDescriptor(ScheduledJobs.prototype, "untyped")
      ?.value as object;
    const savedCron = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, cronMethod);
    const savedInterval = Reflect.getMetadata(SCHEDULE_INTERVAL_OPTIONS, intervalMethod);
    const savedTimeout = Reflect.getMetadata(SCHEDULE_TIMEOUT_OPTIONS, timeoutMethod);

    Reflect.deleteMetadata(SCHEDULE_CRON_OPTIONS, cronMethod);
    Reflect.deleteMetadata(SCHEDULE_INTERVAL_OPTIONS, intervalMethod);
    Reflect.deleteMetadata(SCHEDULE_TIMEOUT_OPTIONS, timeoutMethod);
    Reflect.defineMetadata(SCHEDULER_TYPE, "sideways", untypedMethod);

    try {
      explorerFor(jobs, {}, orchestrator).onModuleInit();
      orchestrator.onApplicationBootstrap();

      expect(registry.doesExist("cron", "decorated-cron")).toBe(false);
      expect(registry.getIntervals()).toEqual([]);
      expect(registry.getTimeouts()).toEqual([]);
      expect(timer.intervals).toEqual([]);
      expect(timer.timeouts).toEqual([]);
    } finally {
      Reflect.defineMetadata(SCHEDULE_CRON_OPTIONS, savedCron, cronMethod);
      Reflect.defineMetadata(SCHEDULE_INTERVAL_OPTIONS, savedInterval, intervalMethod);
      Reflect.defineMetadata(SCHEDULE_TIMEOUT_OPTIONS, savedTimeout, timeoutMethod);
      Reflect.deleteMetadata(SCHEDULER_TYPE, untypedMethod);
    }
  });
});

describe("SchedulerOrchestrator", () => {
  test("refuses a duplicate name of each kind", () => {
    const timer = new FakeTimer();
    const orchestrator = new SchedulerOrchestrator(new SchedulerRegistry(timer), timer);
    const target = () => {};

    orchestrator.addCron(target, "*/1 * * * * *", { name: "cron" });
    orchestrator.addInterval(target, 10, "interval");
    orchestrator.addTimeout(target, 10, "timeout");

    expect(() => orchestrator.addCron(target, "*/1 * * * * *", { name: "cron" })).toThrow(
      AponiaError,
    );
    expect(() => orchestrator.addInterval(target, 10, "interval")).toThrow(AponiaError);
    expect(() => orchestrator.addTimeout(target, 10, "timeout")).toThrow(AponiaError);
  });

  test("mounts an initial delay and clears its handle when the boot stops", () => {
    const timer = new FakeTimer();
    const registry = new SchedulerRegistry(timer);
    const orchestrator = new SchedulerOrchestrator(registry, timer);

    orchestrator.addCron(() => {}, "*/1 * * * * *", {
      name: "delayed",
      initialDelay: 1_000,
    });
    orchestrator.onApplicationBootstrap();

    expect(timer.timeouts).toHaveLength(1);
    expect(timer.timeouts[0]?.delayMs).toBe(1_000);
    const job = registry.getCronJob("delayed");

    timer.timeouts[0]!.handler();
    expect(job.isStopped()).toBe(false);

    orchestrator.beforeApplicationShutdown();
    expect(timer.cleared).toHaveLength(1);

    // The handle a second stop would clear is no longer held, and it answers
    // nothing even if the timer fires it late.
    expect(() => timer.timeouts[0]!.handler()).not.toThrow();
    expect(() => orchestrator.beforeApplicationShutdown()).not.toThrow();
    expect(timer.cleared).toHaveLength(1);
  });

  test("a scheduled target that throws or rejects cannot escape the timer", async () => {
    const timer = new FakeTimer();
    const orchestrator = new SchedulerOrchestrator(new SchedulerRegistry(timer), timer);

    orchestrator.addInterval(
      () => {
        throw new Error("a scheduled method failed");
      },
      10,
      "throwing-interval",
    );
    orchestrator.addTimeout(
      () => Promise.reject(new Error("a scheduled job rejected")),
      10,
      "rejecting-timeout",
    );
    orchestrator.onApplicationBootstrap();

    expect(() => timer.intervals[0]!.handler()).not.toThrow();
    timer.timeouts[0]!.handler();
    await Promise.resolve();
  });
});

describe("CronScheduler", () => {
  test("start is idempotent and shutdown stops what it started", () => {
    const job: CronJob = {
      name: "declared",
      pattern: "0 0 0 1 1 *",
      run: () => {},
    };
    const scheduler = new CronScheduler([job]);

    scheduler.start();
    scheduler.start();
    expect(scheduler.scheduled).toEqual(["declared"]);

    scheduler.onApplicationShutdown();
    expect(scheduler.scheduled).toEqual([]);
    expect(scheduler.jobs).toEqual([job]);
  });

  test("refuses a job list this package cannot schedule", () => {
    const token = createToken<CronConfiguration>(
      "cron.reader",
    ) as unknown as ConfigurationToken<CronConfiguration>;

    expect(readIssues(token, { jobs: "nope" })).toEqual(['"jobs" must be an array of jobs']);
    expect(readIssues(token, { jobs: [null] })).toEqual(["jobs[0] must be an object"]);
    expect(
      readIssues(token, { jobs: [{ name: "n", pattern: "p", run: () => {}, options: "nope" }] }),
    ).toEqual(["jobs[0].options must be an object when it is present"]);
    expect(readIssues(token, { jobs: [{ name: "", pattern: "", run: "no" }] })).toEqual([
      "jobs[0].name must be a non-empty string",
      "jobs[0].pattern must be a non-empty string: a cron expression, an ISO 8601 time, or a date",
      "jobs[0].run must be a function",
    ]);
  });
});

describe("the system timer", () => {
  test("mounts and stops a decorated interval and timeout on a real boot", async () => {
    let beats = 0;

    class SystemTicker {
      @Interval("system-interval", 10)
      beat(): void {
        beats += 1;
      }

      @Timeout("system-timeout", 10_000)
      once(): void {}
    }

    @Module({
      imports: [CronModule.forRoot({ configuration, source: {} })],
      providers: [SystemTicker],
    })
    class TimerModule {}

    const application = await AponiaFactory.create(TimerModule, { logger: false });
    try {
      await Bun.sleep(40);
      const seen = beats;
      expect(seen).toBeGreaterThan(0);

      await application.close();
      await Bun.sleep(40);
      expect(beats).toBe(seen);
    } finally {
      await application.close();
    }
  });
});

function readIssues(
  token: ConfigurationToken<CronConfiguration>,
  value: unknown,
): readonly string[] {
  try {
    readCronJobs(value, token);
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    return (error as AponiaError).details?.issues as readonly string[];
  }
  throw new Error("the reader accepted a value it should have refused");
}
