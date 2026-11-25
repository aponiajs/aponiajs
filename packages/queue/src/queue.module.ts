import {
  AponiaError,
  Module,
  ModuleRef,
  createToken,
  provideAlias,
  provideClass,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { getQueueToken } from "./decorators/inject-queue.decorator.ts";
import { OutboxService } from "./outbox/outbox.service.ts";
import type { OutboxOptions, OutboxStore } from "./interfaces/outbox.interface.ts";
import { ProcessorExplorer } from "./processors/processor.explorer.ts";
import { JobRefService, JOB_REF } from "./queue/job-ref.service.ts";
import { QueueService } from "./queue/queue.service.ts";
import type { QueueServiceOptions } from "./interfaces/queue-service.interface.ts";
import type { QueueStore } from "./interfaces/queue-store.interface.ts";
import type { QueueModuleOptions } from "./interfaces/queue-module.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type QueueModuleExtras,
  type QueueModuleRegistrationAsyncOptions,
  type QueueModuleSyncOptions,
} from "./queue.module-definition.ts";

const QUEUE_OPTIONS = createToken<QueueModuleOptions>("aponia.queue.options");

/**
 * Provides the in-process job queue and the transactional outbox.
 *
 * The registration is one module, so `application.get(QueueService)` reads the
 * queue the application declared. Two registrations are distinct modules.
 */
@Module({})
export class QueueModule extends ConfigurableModuleClass {
  /**
   * Builds one queue registration.
   *
   * Both the queue and the outbox options are validated at registration, so a
   * malformed bound or store fails before the module is imported.
   *
   * @param options - The queue and outbox options, and the queue name.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_QUEUE_OPTIONS` when an option is invalid.
   */
  static forRoot(options: QueueModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options), options.name ?? "default");
  }

  /**
   * Builds a queue registration whose options a factory, a class, or an
   * existing provider resolves.
   *
   * The options are resolved once when the options token first resolves, and
   * validated then, so a refused boot names the same issues `forRoot` reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: QueueModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return registration(
      super.registerAsync(options),
      options.name ?? "default",
      options.extraProviders,
    );
  }

  /**
   * Builds one queue registration.
   *
   * @deprecated Use {@link QueueModule.forRoot}; retained for the beta line.
   */
  static override register(options: QueueModuleSyncOptions = {}): DynamicModule {
    return QueueModule.forRoot(options);
  }

  /**
   * Builds a queue registration whose options a factory resolves.
   *
   * @deprecated Use {@link QueueModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(options: QueueModuleRegistrationAsyncOptions): DynamicModule {
    return QueueModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  name: string,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  const queueToken = getQueueToken(name);
  return Object.freeze({
    ...definition,
    module: QueueModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(QUEUE_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: QueueModuleOptions) =>
        resolveOptions(options),
      ),
      provideFactory(JobRefService, [], () => new JobRefService()),
      provideFactory(
        QueueService,
        [QUEUE_OPTIONS, JobRefService],
        (options: QueueModuleOptions, jobRef: JobRefService) =>
          new QueueService(options.queue, jobRef),
      ),
      provideFactory(
        OutboxService,
        [QUEUE_OPTIONS],
        (options: QueueModuleOptions) => new OutboxService(options.outbox),
      ),
      provideFactory(JOB_REF, [JobRefService], (jobRef: JobRefService) => jobRef.proxy()),
      provideAlias(queueToken, QueueService),
      provideClass(ProcessorExplorer, [QueueService, ModuleRef]),
      ...extraProviders,
    ]),
    exports: Object.freeze([
      MODULE_OPTIONS_TOKEN,
      queueToken,
      JOB_REF,
      QueueService,
      OutboxService,
    ]),
  });
}

function assertExtras(options: Partial<QueueModuleExtras>): void {
  const issues: string[] = [];
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    issues.push("isGlobal must be a boolean");
  }
  if (
    options.name !== undefined &&
    (typeof options.name !== "string" || options.name.trim() === "")
  ) {
    issues.push("name must be a non-empty string");
  }
  if (issues.length > 0) {
    throw invalid(issues);
  }
}

/**
 * Validates one registration's queue and outbox options.
 *
 * The issue list is total: every field that fails is reported, so a refused
 * boot names the whole set rather than the first one found.
 *
 * @param options - The registration options to validate.
 * @returns The frozen options the queue and outbox read.
 * @throws An `AponiaError` with `INVALID_QUEUE_OPTIONS`.
 */
function resolveOptions(options: QueueModuleOptions): QueueModuleOptions {
  if (typeof options !== "object" || options === null) {
    throw invalid(["options must be an object"]);
  }
  const issues: string[] = [...validateQueue(options.queue), ...validateOutbox(options.outbox)];
  if (issues.length > 0) {
    throw invalid(issues);
  }
  return Object.freeze({ ...options });
}

function validateQueue(options: QueueServiceOptions | undefined): readonly string[] {
  if (options === undefined) {
    return [];
  }
  if (typeof options !== "object" || options === null) {
    return ["queue must be an object when present"];
  }
  const issues: string[] = [];
  for (const name of ["concurrency", "maxAttempts", "maxJobs", "maxDeadLetters"] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      issues.push(`${name} must be a positive integer`);
    }
  }
  for (const name of ["backoffMs", "maxBackoffMs"] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      issues.push(`${name} must be a non-negative finite number`);
    }
  }
  if (
    options.jobTimeoutMs !== undefined &&
    (!Number.isInteger(options.jobTimeoutMs) || options.jobTimeoutMs < 0)
  ) {
    issues.push("jobTimeoutMs must be a non-negative integer");
  }
  for (const name of ["autoStart"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "boolean") {
      issues.push(`${name} must be a boolean`);
    }
  }
  for (const name of ["onError", "now"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "function") {
      issues.push(`${name} must be a function`);
    }
  }
  issues.push(...validateQueueStore(options.store));
  return issues;
}

function validateQueueStore(store: QueueStore | undefined): readonly string[] {
  if (store === undefined) {
    return [];
  }
  if (typeof store !== "object" || store === null) {
    return ["store must implement QueueStore"];
  }
  const missing = ["load", "save", "remove", "clear"].filter(
    (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
  );
  return missing.length > 0 ? [`store is missing ${missing.join(", ")}`] : [];
}

function validateOutbox(options: OutboxOptions | undefined): readonly string[] {
  if (options === undefined) {
    return [];
  }
  if (typeof options !== "object" || options === null) {
    return ["outbox must be an object when present"];
  }
  const issues: string[] = [];
  if (
    options.maxEntries !== undefined &&
    (!Number.isInteger(options.maxEntries) || options.maxEntries < 1)
  ) {
    issues.push("outbox.maxEntries must be a positive integer");
  }
  if (options.now !== undefined && typeof options.now !== "function") {
    issues.push("outbox.now must be a function");
  }
  issues.push(...validateOutboxStore(options.store));
  return issues;
}

function validateOutboxStore(store: OutboxStore | undefined): readonly string[] {
  if (store === undefined) {
    return [];
  }
  if (typeof store !== "object" || store === null) {
    return ["outbox.store must implement OutboxStore"];
  }
  const missing = ["list", "append", "update", "remove", "clear"].filter(
    (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
  );
  return missing.length > 0 ? [`outbox.store is missing ${missing.join(", ")}`] : [];
}

function invalid(issues: readonly string[]): AponiaError {
  return new AponiaError("INVALID_QUEUE_OPTIONS", "The queue registration is invalid.", {
    issues: Object.freeze([...issues]),
  });
}
