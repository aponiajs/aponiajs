/**
 * `@aponiajs/events` — typed application events.
 *
 * The package owns the emitter, the listener decorator, and the module an
 * application registers. Delivery is in-process: a handler runs in the process
 * that emitted the event, in registration order. Durable delivery belongs to a
 * queue or an outbox, not here.
 */
export { EventEmitterModule } from "./events.module.ts";
export { EVENT_EMITTER_MODULE_OPTIONS } from "./events.constants.ts";
export { EventEmitter } from "./event-emitter.ts";
export { OnEvent, getEventHandlers } from "./decorators/on-event.decorator.ts";
export type { EventHandler, EventName } from "./interfaces/event-emitter.interface.ts";
export type { EventHandlerMetadata } from "./interfaces/on-event.interface.ts";
