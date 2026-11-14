import { createParamDecorator } from "@aponiajs/common";
import type { Session as SessionRecord } from "../module/session.types.ts";
import type { SessionRequestState } from "./session-service.ts";

/** The session record the plugin loaded for the current request. */
export type Session = SessionRecord;

/**
 * The store key the plugin mirrors its request state onto, so a parameter
 * decorator can answer without reaching the `AsyncLocalStorage`.
 *
 * @internal
 */
export const sessionStateKey = Symbol.for("aponia.session.state");

/**
 * Injects the current session, or one field of its data.
 *
 * `@Session()` answers the whole `Session`; `@Session("user")` answers
 * `session.data.user`. A request with no valid session answers `undefined`.
 * A started session is written by `SessionService.start` during the handler,
 * so this decorator reads the session the plugin loaded before it.
 *
 * @param property - A key of the session's data, or the whole session.
 * @returns A parameter decorator recording the binding.
 *
 * @example
 * ```ts
 * current(@Session("user") user: string | undefined) {}
 * ```
 */
export const Session = createParamDecorator((property, context) => {
  const store = (context as unknown as { readonly store?: Record<PropertyKey, unknown> }).store;
  const state = store?.[sessionStateKey] as SessionRequestState | undefined;
  const session = state?.session;
  if (session === undefined) {
    return undefined;
  }
  if (property === undefined) {
    return session;
  }
  return typeof property === "string" ? session.data[property] : undefined;
});
