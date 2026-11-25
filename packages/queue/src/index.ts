/**
 * `@aponiajs/queue` — an in-process job queue and transactional outbox.
 *
 * The queue runs registered handlers with bounded retries, exponential backoff,
 * a dead letter queue, and idempotent enqueue. The outbox records messages
 * inside a transaction boundary and delivers them after it. Both are
 * process-local and must be replaced with a broker or durable store when the
 * application runs more than one instance.
 */
export { QueueModule } from "./queue.module.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type QueueModuleExtras,
  type QueueModuleRegistrationAsyncOptions,
  type QueueModuleSyncOptions,
} from "./queue.module-definition.ts";
export { getQueueToken, InjectQueue } from "./decorators/inject-queue.decorator.ts";
export { Processor, type ProcessorOptions } from "./decorators/processor.decorator.ts";
export { WorkerHost } from "./hosts/worker-host.ts";
export { JOB_REF, JobRefService } from "./queue/job-ref.service.ts";
export { QueueService } from "./queue/queue.service.ts";
export { OutboxService } from "./outbox/outbox.service.ts";
export { SqliteOutboxStore } from "./outbox/sqlite-outbox.store.ts";
export type { SqliteOutboxStoreOptions } from "./outbox/sqlite-outbox.store.ts";
export { MemoryQueueStore } from "./queue/memory-queue.store.ts";
export type { QueueStore } from "./interfaces/queue-store.interface.ts";
export type {
  QueueModuleAsyncOptions,
  QueueModuleOptions,
} from "./interfaces/queue-module.interface.ts";
export type {
  QueueDrainSummary,
  QueueEnqueueOptions,
  QueueHandler,
  QueueJob,
  QueueJobState,
  QueueStats,
  QueueTimer,
} from "./interfaces/queue-job.interface.ts";
export type { QueueServiceOptions } from "./interfaces/queue-service.interface.ts";
export type {
  OutboxFlushResult,
  OutboxMessage,
  OutboxOptions,
  OutboxSink,
  OutboxStore,
} from "./interfaces/outbox.interface.ts";
