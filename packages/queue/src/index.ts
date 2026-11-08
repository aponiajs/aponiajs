/**
 * `@aponiajs/queue` — an in-process job queue and transactional outbox.
 *
 * The queue runs registered handlers with bounded retries, exponential backoff,
 * a dead letter queue, and idempotent enqueue. The outbox records messages
 * inside a transaction boundary and delivers them after it. Both are
 * process-local and must be replaced with a broker or durable store when the
 * application runs more than one instance.
 */
export { QueueModule } from "./module/queue-module.ts";
export { QueueService } from "./queue/queue-service.ts";
export { OutboxService } from "./outbox/outbox-service.ts";
export { MemoryQueueStore } from "./queue/memory-queue-store.ts";
export type { QueueStore } from "./queue/queue-store.types.ts";
export type { QueueModuleOptions } from "./module/queue-module.types.ts";
export type {
  QueueDrainSummary,
  QueueEnqueueOptions,
  QueueHandler,
  QueueJob,
  QueueJobState,
  QueueStats,
  QueueTimer,
} from "./queue/queue-job.types.ts";
export type { QueueServiceOptions } from "./queue/queue-service.types.ts";
export type {
  OutboxFlushResult,
  OutboxMessage,
  OutboxOptions,
  OutboxSink,
} from "./outbox/outbox.types.ts";
