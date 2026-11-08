import { AponiaError, Injectable } from "@aponiajs/common";
import { getEventHandlers } from "../listener/on-event.ts";
import type { EventHandler, EventName } from "./event-emitter.types.ts";

type EventListener = (payload: unknown) => void | Promise<void>;

interface ListenerEntry {
  readonly handler: EventListener;
  readonly once: boolean;
}

/**
 * In-process event delivery with ordered, awaitable handlers.
 *
 * Every handler registered for an event runs in registration order. A failing
 * handler does not stop the rest: `emit` collects every failure and throws one
 * `EVENT_HANDLER_ERROR` after all handlers have run.
 */
@Injectable()
export class EventEmitter {
  readonly #listeners = new Map<EventName, ListenerEntry[]>();

  /** Registers a handler and returns its unsubscribe function. */
  on<T>(event: EventName, handler: EventHandler<T>): () => void {
    const entry: ListenerEntry = Object.freeze({
      handler: handler as EventListener,
      once: false,
    });
    return this.#add(event, entry);
  }

  /** Registers a handler that is removed before its first invocation. */
  once<T>(event: EventName, handler: EventHandler<T>): () => void {
    const entry: ListenerEntry = Object.freeze({
      handler: handler as EventListener,
      once: true,
    });
    return this.#add(event, entry);
  }

  /** Removes one handler and answers whether it was registered. */
  off(event: EventName, handler: EventHandler): boolean {
    const listeners = this.#listeners.get(event);
    if (listeners === undefined) {
      return false;
    }
    const index = listeners.findIndex((entry) => entry.handler === (handler as EventListener));
    if (index < 0) {
      return false;
    }
    listeners.splice(index, 1);
    if (listeners.length === 0) {
      this.#listeners.delete(event);
    }
    return true;
  }

  /** The number of handlers registered for an event. */
  listenerCount(event: EventName): number {
    return this.#listeners.get(event)?.length ?? 0;
  }

  /**
   * Delivers a payload to every handler registered for an event.
   *
   * @param event - The event name.
   * @param payload - The value every handler receives.
   * @throws An `AponiaError` with `EVENT_HANDLER_ERROR` after every handler ran.
   */
  async emit<T>(event: EventName, payload: T): Promise<void> {
    const snapshot = [...(this.#listeners.get(event) ?? [])];
    const failures: string[] = [];

    for (const entry of snapshot) {
      if (entry.once) {
        this.off(event, entry.handler);
      }
      try {
        await entry.handler(payload);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (failures.length > 0) {
      throw new AponiaError(
        "EVENT_HANDLER_ERROR",
        `Event "${String(event)}" had ${failures.length} handler failure(s).`,
        { event: String(event), failures: Object.freeze(failures) },
      );
    }
  }

  /**
   * Binds every `@OnEvent()` method on an instance.
   *
   * @param instance - The listener instance.
   * @returns A function that unsubscribes every bound handler.
   */
  bind(instance: object): () => void {
    const handlers = getEventHandlers(instance);
    const unsubscribers: (() => void)[] = [];

    for (const metadata of handlers) {
      const handler = (instance as Record<PropertyKey, unknown>)[metadata.propertyKey];
      if (typeof handler !== "function") {
        throw new AponiaError(
          "EVENT_HANDLER_ERROR",
          `The @OnEvent() handler "${String(metadata.propertyKey)}" is not a method on the instance.`,
          { event: String(metadata.event), handler: String(metadata.propertyKey) },
        );
      }
      unsubscribers.push(this.on(metadata.event, handler.bind(instance) as EventHandler));
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  #add(event: EventName, entry: ListenerEntry): () => void {
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(entry);
    this.#listeners.set(event, listeners);

    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.off(event, entry.handler);
    };
  }
}
