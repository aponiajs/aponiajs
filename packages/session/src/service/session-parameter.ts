import { createParamDecorator } from "@aponiajs/common";
import type { Session as SessionRecord } from "../interfaces/session.interface.ts";
import type { SessionRequestState } from "./session.service.ts";

/** The session record the plugin loaded for the current request. */
export type Session = SessionRecord;

/**
 * Per-request state, keyed by the request object.
 *
 * It deliberately never touches the platform `store`: that store is shared by
 * every request on the application, so a concurrent request would overwrite the
 * state a handler is about to read.
 */
const requestStates = new WeakMap<Request, SessionRequestState>();

/**
 * Records the state the session middleware loaded for one request.
 *
 * @internal
 * @param request - The request the middleware is running for.
 * @param state - The state the parameter decorator answers from.
 */
export function setSessionRequestState(request: Request, state: SessionRequestState): void {
  requestStates.set(request, state);
}

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
  const state = requestStates.get(context.request);
  const session = state?.session;
  if (session === undefined) {
    return undefined;
  }
  if (property === undefined) {
    return session;
  }
  return typeof property === "string" ? session.data[property] : undefined;
});
