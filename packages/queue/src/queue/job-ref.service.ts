import { AsyncLocalStorage } from "node:async_hooks";
import { createToken } from "@aponiajs/common";
import type { QueueJob } from "../interfaces/queue-job.interface.ts";

/**
 * The current job inside a processor.
 *
 * `@nestjs/bullmq` aliases this token to its request-scoped `REQUEST`, so a
 * provider injected into a processor can read the job being handled. This
 * package has no per-job request scope, so the value here is a forwarding view:
 * its properties read the job the queue is running in the current async chain,
 * and they are `undefined` outside a handler.
 */
export const JOB_REF = createToken<QueueJob>("JOB_REF");

/** Holds the job a processor is handling for the current async chain. */
export class JobRefService {
  readonly #storage = new AsyncLocalStorage<QueueJob>();

  /** The job the current async chain is handling, if any. */
  current(): QueueJob | undefined {
    return this.#storage.getStore();
  }

  /** @internal Runs one handler with its job as the ambient value. */
  run<T>(job: QueueJob, work: () => T): T {
    return this.#storage.run(job, work);
  }

  /**
   * The value `JOB_REF` resolves to.
   *
   * `@nestjs/bullmq` injects the job directly. A forwarding view keeps that
   * shape: reading `job.id`, `job.name`, or `job.payload` answers the job the
   * current async chain is handling, and nothing outside a handler.
   */
  proxy(): QueueJob {
    const current = (): QueueJob | undefined => this.current();
    return new Proxy({} as QueueJob, {
      get: (_target, property) =>
        (current() as unknown as Record<PropertyKey, unknown> | undefined)?.[property],
      has: (_target, property) => current() !== undefined && property in current()!,
      ownKeys: () => (current() === undefined ? [] : Reflect.ownKeys(current()!)),
      getOwnPropertyDescriptor: (_target, property) =>
        current() === undefined
          ? undefined
          : {
              configurable: true,
              enumerable: true,
              value: (current() as unknown as Record<PropertyKey, unknown>)[property],
            },
    });
  }
}
