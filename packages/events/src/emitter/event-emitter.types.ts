/** A string or symbol event name. */
export type EventName = string | symbol;

/** A handler the emitter invokes with the emitted payload. */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
