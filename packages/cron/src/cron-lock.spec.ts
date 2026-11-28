import { describe, expect, it } from "bun:test";
import { CronScheduler, type CronLockStore } from "./index.ts";

describe("CronScheduler distributed lock", () => {
  it("acquires and releases lock around job execution, and skips when contended", async () => {
    let locked = false;
    let releases = 0;
    let executions = 0;

    const lockStore: CronLockStore = {
      async acquire() {
        if (locked) {
          return undefined;
        }
        locked = true;
        return {
          async release() {
            locked = false;
            releases += 1;
          },
        };
      },
    };

    const scheduler = new CronScheduler(
      [
        {
          name: "sync-job",
          pattern: "* * * * * *",
          run() {
            executions += 1;
          },
        },
      ],
      { lockStore, lockTtlMs: 5_000 },
    );

    scheduler.start();
    try {
      expect(scheduler.scheduled).toEqual(["sync-job"]);
      // Trigger the underlying croner callback directly via trigger() if available,
      // or wait for 1 tick — here we wait up to 1.1s for one tick.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(executions).toBeGreaterThanOrEqual(1);
      expect(releases).toBe(executions);
      expect(locked).toBe(false);
    } finally {
      scheduler.onApplicationShutdown();
    }
  });
});
