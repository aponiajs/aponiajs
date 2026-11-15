import "reflect-metadata";
import type { MicroserviceFailure } from "./microservice.types.ts";

/** Symbol key storing message-handler metadata on controller prototypes. */
export const messagePatternMetadataKey = Symbol.for("aponia.message-pattern.metadata");

/** Symbol key storing the payload property a message handler binds. */
export const messagePayloadMetadataKey = Symbol.for("aponia.message-payload.metadata");

/** Whether a handler answers its caller or only observes the message. */
export type MessagePatternKind = "request" | "event";

/** What one controller method declares about the message it handles. */
export interface MessagePatternMetadata {
  /** The canonical pattern a matching message carries. */
  readonly pattern: string;
  /** Request handlers answer; event handlers discard their result. */
  readonly kind: MessagePatternKind;
}

/**
 * Declares a request/response message handler.
 *
 * The decorated method receives the message payload, optionally narrowed by
 * `@Payload(property)`, and its return value is the reply. A thrown error
 * becomes a `MESSAGE_HANDLER_ERROR` reply whose message never carries the
 * stack or cause.
 *
 * @param pattern - The non-empty string or number a client sends.
 * @returns A method decorator recording the pattern.
 *
 * @example
 * ```ts
 * @MessagePattern("users.findOne")
 * findOne(@Payload("id") id: string) {
 *   return this.users.findById(id);
 * }
 * ```
 */
export function MessagePattern(pattern: string | number): MethodDecorator {
  return recordPattern(pattern, "request");
}

/**
 * Declares an event handler. Its return value is discarded.
 *
 * @param pattern - The non-empty string or number a client emits.
 * @returns A method decorator recording the pattern.
 */
export function EventPattern(pattern: string | number): MethodDecorator {
  return recordPattern(pattern, "event");
}

/**
 * Binds the message payload, or one of its properties, to a handler argument.
 *
 * A handler without this decorator receives the whole payload as its first
 * argument, so a zero-parameter handler simply ignores it.
 *
 * @param property - The payload property to bind, or the whole payload when omitted.
 * @returns A parameter decorator recording the binding.
 */
export function Payload(property?: string): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined): void => {
    if (propertyKey === undefined) {
      throw new TypeError("Payload() must decorate a method parameter.");
    }
    const existing =
      (Reflect.getOwnMetadata(messagePayloadMetadataKey, target) as
        | ReadonlyMap<string | symbol, string | undefined>
        | undefined) ?? new Map();
    const bindings = new Map(existing);
    bindings.set(propertyKey, property);
    Reflect.defineMetadata(messagePayloadMetadataKey, bindings, target);
  };
}

/** Reads every message handler one controller prototype declares. */
export function getMessagePatternMetadata(
  prototype: object,
): ReadonlyMap<string | symbol, MessagePatternMetadata> {
  const recorded = Reflect.getOwnMetadata(messagePatternMetadataKey, prototype) as
    | ReadonlyMap<string | symbol, MessagePatternMetadata>
    | undefined;
  return recorded ?? new Map();
}

/** Reads the payload property one handler binds, or `undefined` for the whole payload. */
export function getMessagePayloadProperty(
  prototype: object,
  propertyKey: string | symbol,
): string | undefined {
  const recorded = Reflect.getOwnMetadata(messagePayloadMetadataKey, prototype) as
    | ReadonlyMap<string | symbol, string | undefined>
    | undefined;
  return recorded?.get(propertyKey);
}

function recordPattern(pattern: string | number, kind: MessagePatternKind): MethodDecorator {
  const normalized = normalizeMessagePattern(pattern);
  return (target: object, propertyKey: string | symbol): void => {
    const existing =
      (Reflect.getOwnMetadata(messagePatternMetadataKey, target) as
        | ReadonlyMap<string | symbol, MessagePatternMetadata>
        | undefined) ?? new Map();
    const handlers = new Map(existing);
    handlers.set(propertyKey, Object.freeze({ pattern: normalized, kind }));
    Reflect.defineMetadata(messagePatternMetadataKey, handlers, target);
  };
}

/** The stable failure code a handler that throws is answered with. */
export const MESSAGE_HANDLER_ERROR_CODE = "MESSAGE_HANDLER_ERROR";

/** The stable failure code an unsubscribed pattern is answered with. */
export const UNKNOWN_MESSAGE_PATTERN_CODE = "UNKNOWN_MESSAGE_PATTERN";

/** The maximum length a message pattern may have. */
export const maximumMessagePatternLength = 256;

/*
 * Patterns are handler keys, not broker addresses, but they travel through
 * brokers that treat `#`, `+`, `*`, `>`, and whitespace as control characters.
 * Restricting them to a conservative canonical grammar keeps one message from
 * escaping a declared broker prefix on any supported transport.
 */
const messagePatternGrammar = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?$/;

/**
 * Reports whether a value is a canonical message pattern.
 *
 * A canonical pattern starts and ends with an alphanumeric character, contains
 * only letters, digits, `.`, `_`, `:`, `/`, and `-`, is at most 256 characters,
 * and never repeats a path separator (`..` or `//`). Broker wildcards and
 * whitespace are never valid.
 *
 * @param value - The value to inspect.
 * @returns Whether the value may be used as a message pattern.
 */
export function isMessagePattern(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumMessagePatternLength
  ) {
    return false;
  }
  return messagePatternGrammar.test(value) && !value.includes("..") && !value.includes("//");
}

/**
 * Normalizes one message pattern.
 *
 * A number becomes its decimal string and surrounding whitespace is trimmed,
 * matching the metadata written by `@MessagePattern`. Every authoring path and
 * every transport shares this function, so a pattern accepted by a decorator is
 * exactly the pattern a transport accepts.
 *
 * @param pattern - The string or number a handler declared or a client sends.
 * @returns The canonical pattern.
 * @throws `TypeError` when the value is empty or not canonical.
 */
export function normalizeMessagePattern(pattern: string | number): string {
  const normalized = typeof pattern === "number" ? String(pattern) : pattern.trim();
  if (!isMessagePattern(normalized)) {
    throw new TypeError(
      "A message pattern must be a canonical alphanumeric key of at most 256 characters without broker wildcards.",
    );
  }
  return normalized;
}

/** Builds one failed reply without leaking a stack or cause. */
export function messageFailure(code: string, message: string): MicroserviceFailure {
  return Object.freeze({ code, message });
}
