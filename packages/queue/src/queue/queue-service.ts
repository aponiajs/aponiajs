import { randomUUID } from "node:crypto";
import { AponiaError, type OnModuleDestroy, type OnModuleInit } from "@aponiajs/common";
import type {
  QueueDrainSummary,
  QueueEnqueueOptions,
  QueueHandler,
  QueueJob,
  QueueStats,
  QueueTimer,
} from "./queue-job.types.ts";
import type { QueueStore } from "./queue-store.types.ts";
import type { QueueServiceOptions, ResolvedQueueServiceOptions } from "./queue-service.types.ts";

interface MutableJob {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  attempts: number;
  readonly maxAttempts: number;
  readonly priority: number;
  readonly timeoutMs: number;
  state: QueueJob["state"];
  readonly enqueuedAt: number;
  availableAt: number;
  readonly idempotencyKey?: string;
  lastError?: string;
}

const zeroSummary: QueueDrainSummary = Object.freeze({
  completed: 0,
  retried: 0,
  deadLettered: 0,
  skipped: 0,
});

/**
 * An in-process job queue with bounded retries, exponential backoff, a dead
 * letter queue, and idempotent enqueue.
 *
 * The queue is process-local. It survives no restart and shares no state with
 * another application instance; a deployment that needs either needs a broker.
 */
export class QueueService implements OnModuleDestroy, OnModuleInit {
  readonly #options: ResolvedQueueServiceOptions;
  readonly #jobs = new Map<string, MutableJob>();
  readonly #deadLetters = new Map<string, MutableJob>();
  readonly #handlers = new Map<string, QueueHandler<unknown>>();
  readonly #idempotency = new Map<string, string>();
  readonly #running = new Set<string>();
  readonly #controllers = new Set<AbortController>();
  readonly #idleWaiters: (() => void)[] = [];
  readonly #store: QueueStore | undefined;
  readonly #writes: Promise<void>[] = [];
  #scheduled: { readonly handle: unknown; readonly delay: number } | undefined;
  #closed = false;
  #paused = false;
  #writeError: unknown;

  /** @internal Construct through `QueueModule.register`. */
  constructor(options: QueueServiceOptions = {}) {
    this.#options = resolveQueueOptions(options);
    if (options.store !== undefined) {
      assertStore(options.store);
    }
    this.#store = options.store;
  }

  /** Registers the handler one job name runs. A later call replaces it. */
  registerHandler<TPayload>(name: string, handler: QueueHandler<TPayload>): void {
    this.#assertOpen();
    if (typeof name !== "string" || name.trim() === "") {
      throw invalidJob("A job name must be a non-empty string.");
    }
    if (typeof handler !== "function") {
      throw invalidJob("A queue handler must be a function.");
    }
    this.#handlers.set(name, handler as QueueHandler<unknown>);
  }

  /** Adds one job and returns a frozen snapshot of it. */
  enqueue<TPayload>(
    name: string,
    payload: TPayload,
    options: QueueEnqueueOptions = {},
  ): QueueJob<TPayload> {
    this.#assertOpen();
    if (typeof name !== "string" || name.trim() === "") {
      throw invalidJob("A job name must be a non-empty string.");
    }
    const idempotencyKey = options.idempotencyKey;
    if (idempotencyKey !== undefined) {
      if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
        throw invalidJob("An idempotency key must be a non-empty string.");
      }
      const existingId = this.#idempotency.get(idempotencyKey);
      const existing =
        existingId === undefined
          ? undefined
          : (this.#jobs.get(existingId) ?? this.#deadLetters.get(existingId));
      if (existing !== undefined) {
        return freezeJob(existing) as unknown as QueueJob<TPayload>;
      }
    }

    const maxAttempts = options.maxAttempts ?? this.#options.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw invalidJob("maxAttempts must be a positive integer.");
    }
    const now = this.#options.now();
    const availableAt = options.availableAt ?? now;
    if (!Number.isFinite(availableAt)) {
      throw invalidJob("availableAt must be a finite timestamp.");
    }
    const priority = options.priority ?? 0;
    if (!Number.isSafeInteger(priority)) {
      throw invalidJob("priority must be a safe integer.");
    }
    const timeoutMs = options.timeoutMs ?? this.#options.jobTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw invalidJob("timeoutMs must be a non-negative integer.");
    }
    if (this.#jobs.size >= this.#options.maxJobs) {
      throw new AponiaError(
        "QUEUE_CAPACITY_EXCEEDED",
        "The queue is full; no job was enqueued.",
        Object.freeze({ maxJobs: this.#options.maxJobs }),
      );
    }

    const job: MutableJob = {
      id: randomUUID(),
      name,
      payload,
      attempts: 0,
      maxAttempts,
      priority,
      timeoutMs,
      state: "pending",
      enqueuedAt: now,
      availableAt,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
    this.#jobs.set(job.id, job);
    if (idempotencyKey !== undefined) {
      this.#idempotency.set(idempotencyKey, job.id);
    }
    this.#persist(job);
    this.#schedule();
    return freezeJob(job) as QueueJob<TPayload>;
  }

  /** Runs every job whose next attempt is due, in batches of the concurrency. */
  async drain(): Promise<QueueDrainSummary> {
    this.#cancelSchedule();
    if (this.#closed) {
      return zeroSummary;
    }
    let completed = 0;
    let retried = 0;
    let deadLettered = 0;
    for (;;) {
      const due = this.#dueJobs().slice(0, this.#options.concurrency);
      if (due.length === 0) {
        break;
      }
      const outcomes = await Promise.all(due.map((job) => this.#process(job)));
      for (const outcome of outcomes) {
        if (outcome === "completed") completed += 1;
        else if (outcome === "retried") retried += 1;
        else deadLettered += 1;
      }
    }
    this.#schedule();
    this.#notifyIdle();
    return Object.freeze({ completed, retried, deadLettered, skipped: 0 });
  }

  /** Resolves once nothing is running and no pending job is due right now. */
  async waitForIdle(): Promise<void> {
    if (this.#isIdle()) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  /** The pending and running jobs. */
  pending(): readonly QueueJob[] {
    return Object.freeze([...this.#jobs.values()].map((job) => freezeJob(job)));
  }

  /** The jobs that exhausted their attempt budget. */
  deadLetters(): readonly QueueJob[] {
    return Object.freeze([...this.#deadLetters.values()].map((job) => freezeJob(job)));
  }

  /** Moves one dead letter back to pending with a fresh attempt budget. */
  retryDeadLetter(id: string): QueueJob {
    this.#assertOpen();
    const job = this.#deadLetters.get(id);
    if (job === undefined) {
      throw invalidJob(`No dead letter job named ${id} exists.`);
    }
    this.#deadLetters.delete(id);
    const revived: MutableJob = {
      ...job,
      attempts: 0,
      state: "pending",
      availableAt: this.#options.now(),
      lastError: undefined,
    };
    this.#jobs.set(id, revived);
    this.#persist(revived);
    this.#schedule();
    return freezeJob(revived);
  }

  /** The current job counts. */
  stats(): QueueStats {
    let pending = 0;
    let running = 0;
    for (const job of this.#jobs.values()) {
      if (job.state === "running") running += 1;
      else pending += 1;
    }
    return Object.freeze({ pending, running, deadLettered: this.#deadLetters.size });
  }

  /** Stops background draining. Later `enqueue` calls refuse. */
  close(): void {
    this.#closed = true;
    this.#cancelSchedule();
    for (const controller of this.#controllers) {
      controller.abort();
    }
    this.#notifyIdle();
  }

  /** Stops automatic draining; an explicit `drain()` still runs. */
  pause(): void {
    this.#paused = true;
    this.#cancelSchedule();
  }

  /** Resumes automatic draining after `pause()`. */
  resume(): void {
    if (this.#closed) {
      return;
    }
    this.#paused = false;
    this.#schedule();
  }

  /** Whether automatic draining is paused. */
  get paused(): boolean {
    return this.#paused;
  }

  /** Drops every job, dead letter, and idempotency key. */
  clear(): void {
    this.#cancelSchedule();
    this.#jobs.clear();
    this.#deadLetters.clear();
    this.#idempotency.clear();
    this.#track(this.#store?.clear());
    this.#notifyIdle();
  }

  /** Awaits the writes the store has accepted, and rethrows the first failure. */
  async flush(): Promise<void> {
    while (this.#writes.length > 0) {
      await Promise.all(this.#writes.splice(0));
    }
    const error = this.#writeError;
    this.#writeError = undefined;
    if (error !== undefined) {
      throw error;
    }
  }

  /** @internal Rebuilds the backlog a store holds when the module initializes. */
  async onModuleInit(): Promise<void> {
    const store = this.#store;
    if (store === undefined) {
      return;
    }
    const stored = await store.load();
    for (const job of stored) {
      const revived = mutableJob(job);
      if (revived.state === "failed") {
        this.#deadLetters.set(revived.id, revived);
        continue;
      }
      revived.state = "pending";
      revived.availableAt = Math.min(revived.availableAt, this.#options.now());
      this.#jobs.set(revived.id, revived);
      if (revived.idempotencyKey !== undefined) {
        this.#idempotency.set(revived.idempotencyKey, revived.id);
      }
    }
    this.#schedule();
  }

  /** @internal The module destroy hook stops background work. */
  async onModuleDestroy(): Promise<void> {
    await this.drain();
    this.close();
    await this.flush();
  }

  async #process(job: MutableJob): Promise<"completed" | "retried" | "deadLettered"> {
    this.#running.add(job.id);
    job.state = "running";
    job.attempts += 1;
    const controller = new AbortController();
    this.#controllers.add(controller);
    try {
      const handler = this.#handlers.get(job.name);
      if (handler === undefined) {
        throw new AponiaError(
          "QUEUE_HANDLER_MISSING",
          `No queue handler is registered for ${job.name}.`,
          Object.freeze({ name: job.name }),
        );
      }
      const result = handler(job.payload, freezeJob(job), controller.signal);
      await (job.timeoutMs > 0
        ? withTimeout(result, job.timeoutMs, this.#options.timer, controller)
        : result);
      this.#jobs.delete(job.id);
      this.#forgetIdempotency(job);
      this.#forget(job.id);
      return "completed";
    } catch (error) {
      job.lastError = describeError(error);
      this.#options.onError(error, freezeJob(job));
      if (job.attempts >= job.maxAttempts) {
        this.#jobs.delete(job.id);
        const dead = { ...job, state: "failed" as const };
        this.#deadLetters.set(job.id, dead);
        this.#persist(dead);
        return "deadLettered";
      }
      job.state = "pending";
      job.availableAt = this.#options.now() + this.#backoff(job.attempts);
      this.#persist(job);
      return "retried";
    } finally {
      this.#controllers.delete(controller);
      this.#running.delete(job.id);
    }
  }

  #forgetIdempotency(job: MutableJob): void {
    if (job.idempotencyKey !== undefined) {
      this.#idempotency.delete(job.idempotencyKey);
    }
  }

  #persist(job: MutableJob): void {
    this.#track(this.#store?.save(freezeJob(job)));
  }

  #forget(id: string): void {
    this.#track(this.#store?.remove(id));
  }

  #track(operation: void | PromiseLike<void> | undefined): void {
    if (operation === undefined) {
      return;
    }
    this.#writes.push(
      Promise.resolve(operation).then(
        () => undefined,
        (error: unknown) => {
          this.#writeError ??= error;
        },
      ),
    );
  }

  #dueJobs(): MutableJob[] {
    const now = this.#options.now();
    return [...this.#jobs.values()]
      .filter((job) => job.state === "pending" && job.availableAt <= now)
      .toSorted(
        (left, right) =>
          right.priority - left.priority ||
          left.enqueuedAt - right.enqueuedAt ||
          left.id.localeCompare(right.id),
      );
  }

  #backoff(attempts: number): number {
    const delay = this.#options.backoffMs * 2 ** (attempts - 1);
    return Math.min(delay, this.#options.maxBackoffMs);
  }

  #schedule(): void {
    if (this.#closed || this.#paused || !this.#options.autoStart) {
      return;
    }
    const now = this.#options.now();
    let delay = Number.POSITIVE_INFINITY;
    for (const job of this.#jobs.values()) {
      if (job.state === "pending") {
        delay = Math.min(delay, Math.max(0, job.availableAt - now));
      }
    }
    if (!Number.isFinite(delay)) {
      return;
    }
    if (this.#scheduled !== undefined && this.#scheduled.delay <= delay) {
      return;
    }
    this.#cancelSchedule();
    const handle = this.#options.timer.setTimeout(() => {
      this.#scheduled = undefined;
      void this.drain();
    }, delay);
    this.#scheduled = { handle, delay };
  }

  #cancelSchedule(): void {
    if (this.#scheduled !== undefined) {
      this.#options.timer.clearTimeout(this.#scheduled.handle);
      this.#scheduled = undefined;
    }
  }

  #isIdle(): boolean {
    if (this.#closed) {
      return true;
    }
    return this.#running.size === 0 && this.#dueJobs().length === 0;
  }

  #notifyIdle(): void {
    if (!this.#isIdle()) {
      return;
    }
    const waiters = this.#idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw invalidJob("The queue is closed.");
    }
  }
}

function freezeJob(job: MutableJob): QueueJob {
  return Object.freeze({
    id: job.id,
    name: job.name,
    payload: job.payload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    priority: job.priority,
    timeoutMs: job.timeoutMs,
    state: job.state,
    enqueuedAt: job.enqueuedAt,
    availableAt: job.availableAt,
    ...(job.idempotencyKey === undefined ? {} : { idempotencyKey: job.idempotencyKey }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
  });
}

function mutableJob(job: QueueJob): MutableJob {
  return {
    id: job.id,
    name: job.name,
    payload: job.payload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    priority: typeof job.priority === "number" ? job.priority : 0,
    timeoutMs: typeof job.timeoutMs === "number" ? job.timeoutMs : 0,
    state: job.state,
    enqueuedAt: job.enqueuedAt,
    availableAt: job.availableAt,
    ...(job.idempotencyKey === undefined ? {} : { idempotencyKey: job.idempotencyKey }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
  };
}

function assertStore(store: QueueStore): void {
  if (typeof store !== "object" || store === null) {
    throw new AponiaError("INVALID_QUEUE_OPTIONS", "The queue store is invalid.", {
      issues: Object.freeze(["store must implement QueueStore"]),
    });
  }
  const missing = ["load", "save", "remove", "clear"].filter(
    (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
  );
  if (missing.length > 0) {
    throw new AponiaError("INVALID_QUEUE_OPTIONS", "The queue store is invalid.", {
      issues: Object.freeze([`store is missing ${missing.join(", ")}`]),
    });
  }
}

function withTimeout<T>(
  value: T | Promise<T>,
  timeoutMs: number,
  timer: QueueTimer,
  controller?: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = timer.setTimeout(() => {
      controller?.abort();
      reject(
        new AponiaError("QUEUE_JOB_TIMEOUT", "The job exceeded its timeout.", {
          timeoutMs,
        }),
      );
    }, timeoutMs);
    Promise.resolve(value).then(
      (result) => {
        timer.clearTimeout(handle);
        resolve(result);
      },
      (error: unknown) => {
        timer.clearTimeout(handle);
        reject(error);
      },
    );
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidJob(issue: string): AponiaError {
  return new AponiaError("INVALID_QUEUE_JOB", issue);
}

const defaultTimer: QueueTimer = Object.freeze({
  setTimeout: (handler: () => void, delayMs: number): unknown => setTimeout(handler, delayMs),
  clearTimeout: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

function resolveQueueOptions(options: QueueServiceOptions): ResolvedQueueServiceOptions {
  const concurrency = options.concurrency ?? 1;
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 100;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const maxJobs = options.maxJobs ?? 1_000;
  const jobTimeoutMs = options.jobTimeoutMs ?? 0;
  const autoStart = options.autoStart ?? true;
  const issues: string[] = [];

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    issues.push("concurrency must be a positive integer");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    issues.push("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    issues.push("backoffMs must be a non-negative finite number");
  }
  if (!Number.isFinite(maxBackoffMs) || maxBackoffMs < 0) {
    issues.push("maxBackoffMs must be a non-negative finite number");
  }
  if (!Number.isInteger(maxJobs) || maxJobs < 1) {
    issues.push("maxJobs must be a positive integer");
  }
  if (!Number.isInteger(jobTimeoutMs) || jobTimeoutMs < 0) {
    issues.push("jobTimeoutMs must be a non-negative integer");
  }
  if (typeof autoStart !== "boolean") {
    issues.push("autoStart must be a boolean");
  }
  if (options.onError !== undefined && typeof options.onError !== "function") {
    issues.push("onError must be a function");
  }
  if (options.now !== undefined && typeof options.now !== "function") {
    issues.push("now must be a function");
  }
  if (issues.length > 0) {
    throw new AponiaError("INVALID_QUEUE_OPTIONS", "The queue registration is invalid.", {
      issues: Object.freeze([...issues]),
    });
  }

  return Object.freeze({
    concurrency,
    maxAttempts,
    backoffMs,
    maxBackoffMs,
    maxJobs,
    jobTimeoutMs,
    autoStart,
    now: options.now ?? Date.now,
    timer: options.timer ?? defaultTimer,
    onError: options.onError ?? (() => {}),
  });
}
