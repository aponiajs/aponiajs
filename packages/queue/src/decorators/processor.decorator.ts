import { AponiaError, type ClassToken } from "@aponiajs/common";
import type { QueueJob } from "../interfaces/queue-job.interface.ts";

const processorMetadataKey = Symbol.for("aponia.queue.processor.metadata");
const processedClasses = new Set<ClassToken<unknown>>();

/** Options `@Processor()` accepts. */
export interface ProcessorOptions {
  /** The job name this processor handles; defaults to `default`. */
  readonly name?: string;
  /** Accepted for `@nestjs/bullmq` compatibility; this package ignores it. */
  readonly scope?: unknown;
  /** Accepted for `@nestjs/bullmq` compatibility; this package ignores it. */
  readonly configKey?: string;
}

/**
 * Marks a `WorkerHost` as the processor for one job name.
 *
 * The in-process queue runs a handler per job name, so the processor's `name`
 * is the job name it handles — there is no broker queue to subscribe to.
 *
 * @param queueNameOrOptions - A job name or processor options.
 * @returns The class decorator.
 * @throws A `TypeError` when the name is empty.
 */
export function Processor(queueNameOrOptions?: string | ProcessorOptions): ClassDecorator {
  const options: ProcessorOptions =
    typeof queueNameOrOptions === "string"
      ? { name: queueNameOrOptions }
      : (queueNameOrOptions ?? {});
  const name = options.name ?? "default";
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("Processor() requires a non-empty name.");
  }

  return (target: object): void => {
    Reflect.defineMetadata(processorMetadataKey, Object.freeze({ ...options, name }), target);
    processedClasses.add(target as ClassToken<unknown>);
  };
}

/** @internal The classes `@Processor()` marked, in declaration order. */
export function getProcessorClasses(): readonly ClassToken<unknown>[] {
  return Object.freeze([...processedClasses]);
}

/** @internal Reads the processor options a class declared. */
export function getProcessorOptions(target: object): ProcessorOptions | undefined {
  const value = Reflect.getOwnMetadata(processorMetadataKey, target);
  return typeof value === "object" && value !== null ? (value as ProcessorOptions) : undefined;
}

/**
 * Refuses a processor whose class does not implement `process`.
 */
export function assertProcessor(instance: object): asserts instance is {
  process(job: QueueJob, token?: string): unknown;
} {
  if (typeof (instance as { readonly process?: unknown }).process !== "function") {
    throw new AponiaError("INVALID_QUEUE_JOB", "A @Processor() class must implement process(job).");
  }
}
