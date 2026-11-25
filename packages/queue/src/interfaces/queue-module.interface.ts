import type { ModuleAsyncOptions } from "@aponiajs/common";
import type { OutboxOptions } from "./outbox.interface.ts";
import type { QueueServiceOptions } from "./queue-service.interface.ts";

/** Options `QueueModule.register` accepts. */
export interface QueueModuleOptions {
  readonly queue?: QueueServiceOptions;
  /** The outbox registration; defaults apply when it is absent. */
  readonly outbox?: OutboxOptions;
}

/** The registration options a factory supplies. */
export type QueueModuleAsyncOptions = ModuleAsyncOptions<QueueModuleOptions>;
