import { Module, provideValue, type DynamicModule } from "@aponiajs/common";
import { OutboxService } from "../outbox/outbox-service.ts";
import { QueueService } from "../queue/queue-service.ts";
import type { QueueModuleOptions } from "./queue-module.types.ts";

/**
 * Provides the in-process job queue and the transactional outbox.
 *
 * The registration is one module, so `application.get(QueueService)` reads the
 * queue the application declared. Two registrations are distinct modules.
 */
@Module({})
export class QueueModule {
  /** Builds one queue registration. */
  static register(options: QueueModuleOptions = {}): DynamicModule {
    const queue = new QueueService(options.queue);
    const outbox = new OutboxService(options.outbox);

    return Object.freeze({
      module: QueueModule,
      id: "QueueModule",
      instanceId: Symbol("QueueModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(QueueService, queue),
        provideValue(OutboxService, outbox),
      ]),
      exports: Object.freeze([QueueService, OutboxService]),
    });
  }
}
