import type { OutboxOptions } from "../outbox/outbox.types.ts";
import type { QueueServiceOptions } from "../queue/queue-service.types.ts";

/** Options `QueueModule.register` accepts. */
export interface QueueModuleOptions {
  readonly queue?: QueueServiceOptions;
  /** The outbox registration; defaults apply when it is absent. */
  readonly outbox?: OutboxOptions;
}
