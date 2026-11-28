import type { EventName } from "./event-emitter.interface.ts";

/** One method decorator's event and property key. */
export interface EventHandlerMetadata {
  readonly event: EventName;
  readonly propertyKey: string | symbol;
}
