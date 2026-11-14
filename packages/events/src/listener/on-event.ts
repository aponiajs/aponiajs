import type { EventName } from "../emitter/event-emitter.types.ts";
import type { EventHandlerMetadata } from "./on-event.types.ts";

const eventHandlersMetadataKey = Symbol.for("aponia.events.handlers.metadata");

/**
 * Declares a method as a listener for one event.
 *
 * The decorator only records metadata. `EventEmitter.bind(instance)` binds the
 * methods, so a listener is an ordinary provider the application already owns.
 *
 * @param event - The event name the method handles.
 * @returns A method decorator recording the listener.
 */
export function OnEvent(event: EventName): MethodDecorator {
  return (target, propertyKey) => {
    const handlers =
      (Reflect.getOwnMetadata(eventHandlersMetadataKey, target) as
        | readonly EventHandlerMetadata[]
        | undefined) ?? [];
    Reflect.defineMetadata(
      eventHandlersMetadataKey,
      Object.freeze([...handlers, Object.freeze({ event, propertyKey })]),
      target,
    );
  };
}

/**
 * Reads the listener methods a class declares, including inherited methods.
 *
 * @param target - The class or instance to read.
 * @returns The frozen listener metadata, in declaration order.
 */
export function getEventHandlers(target: object): readonly EventHandlerMetadata[] {
  return (
    (Reflect.getMetadata(eventHandlersMetadataKey, target) as
      | readonly EventHandlerMetadata[]
      | undefined) ?? Object.freeze([])
  );
}
