import { AsyncLocalStorage } from "node:async_hooks";
import type { AponiaMiddleware, RouteContext } from "@aponiajs/common";
import { clearCookie, readCookies, writeCookie } from "@aponiajs/platform-core";
import { issueSessionToken, readSessionId } from "../policy/session-token.ts";
import type { SessionRequestState } from "../service/session.service.ts";
import { setSessionRequestState } from "../service/session-parameter.ts";
import type {
  ResolvedSessionOptions,
  Session as SessionRecord,
  SessionStore,
} from "../interfaces/session.interface.ts";

/**
 * Loads the session a request's cookie names, and writes the cookie the handler
 * changed.
 *
 * It runs before the route's guards and after it, which is exactly the window a
 * session needs: the state is entered before anything can read it, and the
 * cookie is written once the handler has had its say. The middleware is
 * runtime-neutral — the cookie is read from the request context and written
 * into the response settings — so one implementation serves every platform.
 */
export class SessionMiddleware implements AponiaMiddleware {
  readonly #storage: AsyncLocalStorage<SessionRequestState>;
  readonly #store: SessionStore;
  readonly #options: ResolvedSessionOptions;

  constructor(
    storage: AsyncLocalStorage<SessionRequestState>,
    store: SessionStore,
    options: ResolvedSessionOptions,
  ) {
    this.#storage = storage;
    this.#store = store;
    this.#options = options;
  }

  async use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    const state: SessionRequestState = {
      session: undefined,
      started: false,
      touched: false,
      destroyed: false,
      writeCookie: (session) => {
        this.#writeCookie(context, session);
      },
      clearCookie: () => {
        this.#clearCookie(context);
      },
    };
    this.#storage.enterWith(state);
    setSessionRequestState(context.request, state);

    await this.#load(context, state);
    return await next();
  }

  async #load(context: RouteContext, state: SessionRequestState): Promise<void> {
    const token = readCookies(context.request)[this.#options.cookieName]?.value;
    if (typeof token !== "string") {
      return;
    }

    const id = readSessionId(token, this.#options.secret);
    if (id === undefined) {
      state.destroyed = true;
      state.clearCookie?.();
      return;
    }

    const session = await this.#store.get(id);
    if (session === undefined || session.expiresAt <= Date.now()) {
      state.destroyed = true;
      state.clearCookie?.();
      return;
    }

    state.session = session;
    if (this.#options.rolling) {
      const extended = Object.freeze({
        ...session,
        expiresAt: Date.now() + this.#options.ttlMs,
      });
      await this.#store.set(extended);
      state.session = extended;
      state.touched = true;
      state.writeCookie?.(extended);
    }
  }

  #writeCookie(context: RouteContext, session: SessionRecord): void {
    const attributes = this.#options.cookie;

    writeCookie(
      context.set,
      this.#options.cookieName,
      issueSessionToken(session.id, this.#options.secret),
      {
        httpOnly: true,
        secure: attributes.secure,
        sameSite: attributes.sameSite,
        path: attributes.path,
        maxAge: Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1_000)),
        ...(attributes.domain === undefined ? {} : { domain: attributes.domain }),
      },
    );
  }

  #clearCookie(context: RouteContext): void {
    const attributes = this.#options.cookie;
    clearCookie(context.set, this.#options.cookieName, {
      path: attributes.path,
      ...(attributes.domain === undefined ? {} : { domain: attributes.domain }),
    });
  }
}
