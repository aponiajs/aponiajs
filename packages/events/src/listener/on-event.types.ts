import type { EventName } from "../emitter/event-emitter.types.ts";

/** One method decorator's event and property key. */
export interface EventHandlerMetadata {
  readonly event: EventName;
  readonly propertyKey: string | symbol;
}
