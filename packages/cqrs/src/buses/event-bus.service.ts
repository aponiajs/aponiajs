import { Injectable, type ClassToken, type OnModuleDestroy } from "@aponiajs/common";
import type { ICommand, IEvent, IEventHandler, ISaga } from "../interfaces/cqrs.interface.ts";
import { CommandBus } from "./command-bus.service.ts";

/**
 * Publishes domain events to `@EventsHandler()` listeners and `@Saga()` streams
 * using native Promises and `AsyncIterable` without RxJS.
 */
@Injectable()
export class EventBus<TEventBase extends IEvent = IEvent> implements OnModuleDestroy {
  readonly #handlers = new Map<ClassToken<unknown>, Set<IEventHandler<TEventBase>>>();
  readonly #subscribers = new Set<(event: TEventBase) => void>();
  readonly #sagaControllers: AbortController[] = [];
  readonly #commandBus: CommandBus;

  constructor(commandBus: CommandBus) {
    this.#commandBus = commandBus;
  }

  /** Registers an event handler instance for `eventType`. */
  registerHandler(eventType: ClassToken<unknown>, handler: IEventHandler<TEventBase>): void {
    let set = this.#handlers.get(eventType);
    if (set === undefined) {
      set = new Set();
      this.#handlers.set(eventType, set);
    }
    set.add(handler);
  }

  /** Subscribes a listener callback and returns an unsubscribe function. */
  subscribe(listener: (event: TEventBase) => void): () => void {
    this.#subscribers.add(listener);
    return () => {
      this.#subscribers.delete(listener);
    };
  }

  /** Returns an `AsyncIterable` stream of all published events until `signal` aborts. */
  events(signal?: AbortSignal): AsyncIterable<TEventBase> {
    const subscribe = this.subscribe.bind(this);
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TEventBase> {
        const queue: TEventBase[] = [];
        let wake: (() => void) | undefined;
        let closed = signal?.aborted === true;

        const onAbort = () => {
          closed = true;
          wake?.();
          wake = undefined;
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const unsubscribe = subscribe((event) => {
          queue.push(event);
          wake?.();
          wake = undefined;
        });

        try {
          while (!closed) {
            if (queue.length > 0) {
              yield queue.shift() as TEventBase;
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          while (queue.length > 0) {
            yield queue.shift() as TEventBase;
          }
        } finally {
          unsubscribe();
          signal?.removeEventListener("abort", onAbort);
        }
      },
    };
  }

  /** Filters `events()` to instances of `eventType`. */
  async *ofType<TMatched extends TEventBase>(
    eventType: ClassToken<TMatched>,
    signal?: AbortSignal,
  ): AsyncIterable<TMatched> {
    for await (const event of this.events(signal)) {
      if (event instanceof (eventType as unknown as new (...args: never[]) => TMatched)) {
        yield event;
      }
    }
  }

  /** Starts a saga against this event bus and dispatches yielded commands. */
  registerSaga(saga: ISaga<TEventBase, ICommand>): void {
    const controller = new AbortController();
    this.#sagaControllers.push(controller);
    const stream = saga(this.events(controller.signal));

    void (async () => {
      try {
        for await (const command of stream) {
          if (controller.signal.aborted) {
            break;
          }
          if (command !== undefined) {
            await this.#commandBus.execute(command);
          }
        }
      } catch {
        // Saga termination on shutdown is ignored.
      }
    })();
  }

  /** Publishes a single event to matching `@EventsHandler()` instances and active streams. */
  async publish<T extends TEventBase>(event: T): Promise<void> {
    for (const listener of this.#subscribers) {
      listener(event);
    }

    const eventType = (event as unknown as { constructor: ClassToken<unknown> }).constructor;
    const handlers = this.#handlers.get(eventType);
    if (handlers === undefined) {
      return;
    }

    await Promise.all([...handlers].map((handler) => Promise.resolve(handler.handle(event))));
  }

  /** Publishes multiple events concurrently. */
  async publishAll<T extends TEventBase>(events: readonly T[]): Promise<void> {
    await Promise.all(events.map((event) => this.publish(event)));
  }

  onModuleDestroy(): void {
    for (const controller of this.#sagaControllers.splice(0)) {
      controller.abort();
    }
    this.#subscribers.clear();
  }
}
