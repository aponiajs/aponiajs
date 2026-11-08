/**
 * `@aponiajs/events` — typed application events.
 *
 * The package owns the emitter, the listener decorator, and the module an
 * application registers. Delivery is in-process: a handler runs in the process
 * that emitted the event, in registration order. Durable delivery belongs to a
 * queue or an outbox, not here.
 */
export { EventEmitterModule } from "./module/event-emitter-module.ts";
export { EventEmitter } from "./emitter/event-emitter.ts";
export { OnEvent, getEventHandlers } from "./listener/on-event.ts";
export type { EventHandler, EventName } from "./emitter/event-emitter.types.ts";
export type { EventHandlerMetadata } from "./listener/on-event.types.ts";
