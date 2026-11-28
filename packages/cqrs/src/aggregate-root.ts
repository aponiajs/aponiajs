import { Injectable } from "@aponiajs/common";
import { EventBus } from "./buses/event-bus.service.ts";
import type { IEvent } from "./interfaces/cqrs.interface.ts";

/**
 * Base class for domain aggregates tracking uncommitted events.
 */
export abstract class AggregateRoot<TEvent extends IEvent = IEvent> {
  #uncommittedEvents: TEvent[] = [];

  /** Applies an event onto the aggregate and records it if `isFromHistory` is false. */
  apply(event: TEvent, isFromHistory = false): void {
    if (!isFromHistory) {
      this.#uncommittedEvents.push(event);
    }
    const handlerName = `on${(event as { constructor: { name: string } }).constructor.name}`;
    const candidate = (this as Record<string, unknown>)[handlerName];
    if (typeof candidate === "function") {
      (candidate as (event: TEvent) => void).call(this, event);
    }
  }

  /** Returns all uncommitted events recorded since the last `commit()` or `uncommit()`. */
  getUncommittedEvents(): readonly TEvent[] {
    return Object.freeze([...this.#uncommittedEvents]);
  }

  /** Clears the uncommitted event buffer without publishing. */
  uncommit(): void {
    this.#uncommittedEvents = [];
  }

  /** Publishes all uncommitted events via the bound `publishAll` hook and clears the buffer. */
  async commit(): Promise<void> {
    const events = this.#uncommittedEvents;
    this.#uncommittedEvents = [];
    await this.publishAll(events);
  }

  /** Replays historical events without recording them as uncommitted. */
  loadFromHistory(history: readonly TEvent[]): void {
    for (const event of history) {
      this.apply(event, true);
    }
  }

  /** Overridden by `EventPublisher.mergeObjectContext()` to publish committed events. */
  publishAll(_events: readonly TEvent[]): Promise<void> | void {}
}

/**
 * Connects `AggregateRoot` instances to `EventBus` so `aggregate.commit()`
 * publishes uncommitted domain events automatically.
 */
@Injectable()
export class EventPublisher<TEvent extends IEvent = IEvent> {
  readonly #eventBus: EventBus<TEvent>;

  constructor(eventBus: EventBus<TEvent>) {
    this.#eventBus = eventBus;
  }

  /** Binds `aggregate.commit()` to `EventBus.publishAll()`. */
  mergeObjectContext<T extends AggregateRoot<TEvent>>(aggregate: T): T {
    aggregate.publishAll = (events) => this.#eventBus.publishAll(events);
    return aggregate;
  }
}
