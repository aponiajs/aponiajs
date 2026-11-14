import {
  LOGGER,
  NOOP_LOGGER,
  Reflector,
  provideClass,
  provideValue,
  type LoggerService,
  type Token,
} from "@aponiajs/common";
import { createContainer, type AponiaContainer } from "@aponiajs/core";
import { compileModuleInMemory } from "../compiler/in-memory-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { runShutdownHooks } from "./application-bootstrap.ts";
import { collectLifecycleCalls } from "./lifecycle-hooks.ts";

/** A loaded module graph with no listener or controller mount. */
export class LazyModuleRef {
  readonly #container: AponiaContainer;
  readonly #logger: LoggerService | undefined;
  #closed = false;

  /** @internal Construct through `LazyModuleLoader.load`. */
  constructor(container: AponiaContainer, logger: LoggerService | undefined) {
    this.#container = container;
    this.#logger = logger;
  }

  /** Resolves a token visible from the lazy module's root. */
  get<T>(token: Token<T>): T {
    return this.#container.get(token);
  }

  /** Runs the lazy graph's shutdown hooks once. */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await runShutdownHooks(
      collectLifecycleCalls(this.#container, "beforeApplicationShutdown", false),
      this.#logger,
    );
    await runShutdownHooks(
      [...collectLifecycleCalls(this.#container, "onModuleDestroy", false)].reverse(),
      this.#logger,
    );
    await runShutdownHooks(
      collectLifecycleCalls(this.#container, "onApplicationShutdown", false),
      this.#logger,
    );
  }
}

/** Loads module graphs after the application has booted. */
export class LazyModuleLoader {
  #logger: LoggerService | undefined;

  /** @internal Construct through `AponiaFactory.create`. */
  constructor(logger?: LoggerService) {
    this.#logger = logger;
  }

  /**
   * Loads one module graph and runs its provider lifecycle.
   *
   * @param load - A function returning the module class or descriptor, which
   * may be an `import()` promise.
   * @returns The loaded module reference.
   */
  async load(load: () => AponiaRootModule | Promise<AponiaRootModule>): Promise<LazyModuleRef> {
    const root = await load();
    const compiledRoot = compileModuleInMemory(root);
    const container = createContainer(compiledRoot, [
      provideValue(LOGGER, this.#logger ?? NOOP_LOGGER),
      provideValue(LazyModuleLoader, this),
      provideClass(Reflector, []),
    ]);

    for (const module of container.graph.modules) {
      container.initializeModule(module);
    }
    for (const call of collectLifecycleCalls(container, "onModuleInit", false)) {
      await call();
    }
    for (const call of collectLifecycleCalls(container, "onApplicationBootstrap", false)) {
      await call();
    }

    return new LazyModuleRef(container, this.#logger);
  }
}
