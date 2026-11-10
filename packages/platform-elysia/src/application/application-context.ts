import {
  LOGGER,
  NOOP_LOGGER,
  notifySystemLogger,
  provideValue,
  type LoggerService,
  type Token,
} from "@aponiajs/common";
import { createContainer, type AponiaContainer } from "@aponiajs/core";
import { compileModuleInMemory } from "../compiler/in-memory-compiler.ts";
import { selectRootModuleDescriptor } from "../modules/module-descriptor-artifact.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { aponiaVersion } from "../version.ts";
import { createSystemLogger, runShutdownHooks } from "./application-bootstrap.ts";
import type { AponiaApplicationOptions } from "./application.types.ts";
import { collectLifecycleCalls } from "./lifecycle-hooks.ts";
import { LazyModuleLoader } from "./lazy-module-loader.ts";
import {
  collectMessageHandlers,
  createMicroserviceHandlerTable,
  startMicroserviceTransports,
  type MicroserviceRuntime,
} from "../microservices/microservice-runtime.ts";

/**
 * A booted module graph with no HTTP listener.
 *
 * Providers initialize and run their lifecycle hooks exactly as they do in an
 * HTTP application, but controllers are not mounted and no route is compiled.
 * Use it for workers, command-line tasks, and tests that need the container
 * without a server.
 */
export class AponiaApplicationContext {
  readonly #container: AponiaContainer;
  readonly #logger: LoggerService | undefined;
  #microserviceRuntime: MicroserviceRuntime | undefined;
  #closed = false;

  private constructor(
    container: AponiaContainer,
    logger: LoggerService | undefined,
    microserviceRuntime: MicroserviceRuntime | undefined,
  ) {
    this.#container = container;
    this.#logger = logger;
    this.#microserviceRuntime = microserviceRuntime;
  }

  /**
   * Boots a module graph without a listener.
   *
   * @param rootModule - The root class, descriptor, or descriptor artifact.
   * @param options - Logger, descriptor, and microservice options; route options are ignored.
   * @returns A context that resolves providers and owns their shutdown plan.
   */
  static async create(
    rootModule: AponiaRootModule,
    options: Pick<AponiaApplicationOptions, "logger" | "descriptors" | "microservices"> = {},
  ): Promise<AponiaApplicationContext> {
    const logger = createSystemLogger(options.logger);
    if (logger !== undefined) {
      notifySystemLogger(logger);
    }
    logger?.log("Starting Aponia application context...", "AponiaFactory");

    const rootSelection = selectRootModuleDescriptor(
      options.descriptors,
      rootModule,
      aponiaVersion,
      logger,
    );
    const compiledRoot = compileModuleInMemory(rootSelection.rootModule);
    const lazyModuleLoader = new LazyModuleLoader(logger);
    const container = createContainer(compiledRoot, [
      provideValue(LOGGER, logger ?? NOOP_LOGGER),
      provideValue(LazyModuleLoader, lazyModuleLoader),
    ]);

    for (const module of container.graph.modules) {
      container.initializeModule(module);
      logger?.log(`${module.id} dependencies initialized`, "InstanceLoader");
    }

    for (const call of collectLifecycleCalls(container, "onModuleInit", false)) {
      await call();
    }
    for (const call of collectLifecycleCalls(container, "onApplicationBootstrap", false)) {
      await call();
    }

    // A worker answers messages without mounting HTTP routes. Controllers are
    // instantiated here only when a transport is configured, because that is
    // the only case in which their message metadata is consumed.
    const messageHandlers = createMicroserviceHandlerTable();
    if (options.microservices !== undefined && options.microservices.length > 0) {
      for (const module of container.graph.modules) {
        for (const controller of module.controllers) {
          collectMessageHandlers(
            messageHandlers,
            controller,
            container.instantiateController(module, controller),
          );
        }
      }
    }
    const microserviceRuntime = await startMicroserviceTransports(
      options.microservices,
      messageHandlers,
      logger,
    );

    return new AponiaApplicationContext(container, logger, microserviceRuntime);
  }

  /** Resolves a token visible from the root module. */
  get<T>(token: Token<T>): T {
    return this.#container.get(token);
  }

  /** Resolves a token for an optional request context. */
  resolve<T>(token: Token<T>, context?: object): T {
    return this.#container.get(token, context);
  }

  /**
   * Runs the shutdown hooks once and releases the context.
   *
   * @param signal - The process signal that asked for the stop, when one did.
   */
  async close(signal?: string): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    await this.#microserviceRuntime?.close();
    this.#microserviceRuntime = undefined;
    await runShutdownHooks(
      collectLifecycleCalls(this.#container, "beforeApplicationShutdown", false),
      this.#logger,
      signal,
    );
    await runShutdownHooks(
      [...collectLifecycleCalls(this.#container, "onModuleDestroy", false)].reverse(),
      this.#logger,
    );
    await runShutdownHooks(
      collectLifecycleCalls(this.#container, "onApplicationShutdown", false),
      this.#logger,
      signal,
    );
  }
}
