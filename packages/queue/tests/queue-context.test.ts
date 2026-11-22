import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, test } from "bun:test";
import { registerAsyncContextExit } from "@aponiajs/common";
import { QueueService } from "../src/index.ts";

describe("QueueService async context", () => {
  test("runs a job outside every registered request-context store", async () => {
    const storage = new AsyncLocalStorage<{ readonly tenant: string }>();
    const unregister = registerAsyncContextExit((work) => storage.exit(work));
    try {
      const queue = new QueueService({ autoStart: false });
      const seen: (string | undefined)[] = [];
      queue.registerHandler("job", () => {
        seen.push(storage.getStore()?.tenant);
      });

      storage.run({ tenant: "tenant-a" }, () => {
        queue.enqueue("job", null);
      });
      await storage.run({ tenant: "tenant-b" }, () => queue.drain());

      expect(seen).toEqual([undefined]);
    } finally {
      unregister();
    }
  });
});
