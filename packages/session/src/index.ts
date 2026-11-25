/**
 * `@aponiajs/session` — signed session cookies and a bounded session store.
 *
 * The session cookie carries a signed id; the session data lives in the store.
 * A handler starts, updates, or destroys the current session through
 * `SessionService`; a global plugin reads the cookie before the handler and
 * writes or removes it after the handler.
 */
export { SessionModule } from "./module/session.module.ts";
export { Session } from "./service/session-parameter.ts";
export { SessionService } from "./service/session.service.ts";
export { MemorySessionStore } from "./store/memory-session.store.ts";
export type {
  SessionCookieOptions,
  SessionModuleAsyncOptions,
  SessionModuleOptions,
  SessionStore,
} from "./interfaces/session.interface.ts";
export type { MemorySessionStoreOptions } from "./interfaces/memory-session-store.interface.ts";
