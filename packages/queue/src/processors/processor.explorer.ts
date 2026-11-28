import { Inject, Injectable, ModuleRef, type OnModuleInit } from "@aponiajs/common";
import {
  assertProcessor,
  getProcessorClasses,
  getProcessorOptions,
} from "../decorators/processor.decorator.ts";
import { QueueService } from "../queue/queue.service.ts";

/**
 * Registers every `@Processor()` class as the handler for its job name.
 *
 * A processor class must also be a provider of some module so the container can
 * construct it; a class that is not provided is skipped rather than
 * constructed twice.
 */
@Injectable()
export class ProcessorExplorer implements OnModuleInit {
  readonly #queue: QueueService;
  readonly #moduleRef: ModuleRef;

  constructor(@Inject(QueueService) queue: QueueService, @Inject(ModuleRef) moduleRef: ModuleRef) {
    this.#queue = queue;
    this.#moduleRef = moduleRef;
  }

  onModuleInit(): void {
    for (const processorClass of getProcessorClasses()) {
      const options = getProcessorOptions(processorClass);
      if (options === undefined) {
        continue;
      }

      let instance: object;
      try {
        instance = this.#moduleRef.get(processorClass, { strict: false }) as object;
      } catch {
        continue;
      }
      assertProcessor(instance);
      const processor = instance as { process(job: never, token?: string): unknown };
      this.#queue.registerHandler(options.name ?? "default", (_payload, job) =>
        processor.process(job as never),
      );
    }
  }
}
