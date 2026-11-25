import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { AponiaError, registerAsyncContextExit } from "@aponiajs/common";
import type {
  ResolvedSessionOptions,
  Session,
  SessionStore,
} from "../interfaces/session.interface.ts";

/** The mutable state one request carries between the plugin and the service. */
export interface SessionRequestState {
  session: Session | undefined;
  started: boolean;
  touched: boolean;
  destroyed: boolean;
  /**
   * Writes the response cookie for one session.
   *
   * The plugin installs it before the request reaches the handler, and the
   * service calls it the moment the session changes. Writing at the change
   * rather than after `next()` keeps the cookie correct on a platform whose
   * middleware chain does not wrap the handler.
   */
  writeCookie?: ((session: Session) => void) | undefined;
  /** Clears the response cookie. */
  clearCookie?: (() => void) | undefined;
}

/** The session operations a handler calls. */
export class SessionService {
  readonly #storage: AsyncLocalStorage<SessionRequestState>;
  readonly #store: SessionStore;
  readonly #options: ResolvedSessionOptions;

  /** @internal Construct through `SessionModule.register`. */
  constructor(
    storage: AsyncLocalStorage<SessionRequestState>,
    store: SessionStore,
    options: ResolvedSessionOptions,
  ) {
    this.#storage = storage;
    registerAsyncContextExit((work) => this.#storage.exit(work));
    this.#store = store;
    this.#options = options;
  }

  /** The session loaded for the current request, if one is valid. */
  current(): Session | undefined {
    return this.#storage.getStore()?.session;
  }

  /** Starts a new session and marks its cookie for the response. */
  async start<TData extends Record<string, unknown> = Record<string, unknown>>(
    data: TData = {} as TData,
  ): Promise<Session<TData>> {
    const state = this.#state();
    const now = Date.now();
    const session = Object.freeze({
      id: randomUUID(),
      data: Object.freeze({ ...data }),
      createdAt: now,
      expiresAt: now + this.#options.ttlMs,
    }) as Session<TData>;
    await this.#store.set(session);
    state.session = session;
    state.started = true;
    state.destroyed = false;
    state.writeCookie?.(session);
    return session;
  }

  /**
   * Replaces the current session with a new id and a new lifetime.
   *
   * Call it when a session's privilege changes — after login, a role change, or
   * a password reset — so an id an attacker obtained before that point stops
   * being accepted. The old entry is deleted, the new id is written, and the
   * response carries the new cookie just as `start` does.
   */
  async regenerate<TData extends Record<string, unknown> = Record<string, unknown>>(
    data: TData = {} as TData,
  ): Promise<Session<TData>> {
    const state = this.#state();
    const current = state.session;
    if (current !== undefined) {
      await this.#store.delete(current.id);
    }
    const now = Date.now();
    const session = Object.freeze({
      id: randomUUID(),
      data: Object.freeze({ ...data }),
      createdAt: now,
      expiresAt: now + this.#options.ttlMs,
    }) as Session<TData>;
    await this.#store.set(session);
    state.session = session;
    state.started = true;
    state.touched = false;
    state.destroyed = false;
    state.writeCookie?.(session);
    return session;
  }

  /** Replaces the current session's data. */
  async update<TData extends Record<string, unknown>>(
    data: TData,
  ): Promise<Session<TData> | undefined> {
    const state = this.#state();
    const current = state.session;
    if (current === undefined) {
      return undefined;
    }
    const now = Date.now();
    const session = Object.freeze({
      id: current.id,
      data: Object.freeze({ ...data }),
      createdAt: current.createdAt,
      expiresAt: this.#options.rolling ? now + this.#options.ttlMs : current.expiresAt,
    }) as Session<TData>;
    await this.#store.set(session);
    state.session = session;
    state.touched = this.#options.rolling;
    if (state.touched) {
      state.writeCookie?.(session);
    }
    return session;
  }

  /** Destroys the current session and removes its cookie. */
  async destroy(): Promise<boolean> {
    const state = this.#state();
    const current = state.session;
    if (current === undefined) {
      state.destroyed = true;
      return false;
    }
    const deleted = await this.#store.delete(current.id);
    state.session = undefined;
    state.destroyed = true;
    state.clearCookie?.();
    return deleted;
  }

  /** Reads a session by id, outside the current request. */
  get(id: string): Session | undefined | Promise<Session | undefined> {
    return this.#store.get(id);
  }

  /** Removes every session in the store. */
  async clear(): Promise<void> {
    await this.#store.clear();
  }

  #state(): SessionRequestState {
    const state = this.#storage.getStore();
    if (state === undefined) {
      throw new AponiaError(
        "MISSING_REQUEST_CONTEXT",
        "SessionService must be used inside a session-enabled request.",
        { service: "SessionService" },
      );
    }
    return state;
  }
}
