import { AsyncLocalStorage } from "node:async_hooks";
import { AponiaError, Module, provideValue, type DynamicModule } from "@aponiajs/common";
import { PluginModule, type ElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { issueSessionToken, readSessionId } from "../policy/session-token.ts";
import { SessionService, type SessionRequestState } from "../service/session-service.ts";
import { MemorySessionStore } from "../store/memory-session-store.ts";
import type {
  ResolvedSessionOptions,
  SessionModuleOptions,
  SessionStore,
} from "./session.types.ts";

const defaultTtlMs = 86_400_000;
const defaultMaxSessions = 10_000;

/** Provides the session service and mounts the cookie plugin. */
@Module({})
export class SessionModule {
  /**
   * Builds a session registration.
   *
   * @param options - Secret, cookie, TTL, store, and rolling policy.
   * @returns The module registration an application imports.
   * @throws An `AponiaError` with `INVALID_SESSION_OPTIONS` when an option is invalid.
   */
  static register(options: SessionModuleOptions): DynamicModule {
    const resolved = resolveOptions(options);
    const store = options.store ?? new MemorySessionStore({ maxSessions: resolved.maxSessions });
    const storage = new AsyncLocalStorage<SessionRequestState>();
    const service = new SessionService(storage, store, resolved);
    const plugin = buildSessionPlugin(storage, store, resolved);
    const pluginModule = PluginModule.register(plugin, { key: options.key ?? "session" });

    return Object.freeze({
      ...pluginModule,
      providers: Object.freeze([
        ...(pluginModule.providers ?? []),
        provideValue(SessionService, service),
      ]),
      exports: Object.freeze([SessionService]),
    });
  }
}

function buildSessionPlugin(
  storage: AsyncLocalStorage<SessionRequestState>,
  store: SessionStore,
  options: ResolvedSessionOptions,
): ElysiaPlugin {
  return new Elysia({ name: "aponia:session", seed: options })
    .onBeforeHandle("global", async (context) => {
      const state: SessionRequestState = {
        session: undefined,
        started: false,
        touched: false,
        destroyed: false,
      };
      storage.enterWith(state);

      const cookie = context.cookie[options.cookieName];
      const token = cookie.value;
      if (typeof token !== "string") {
        return;
      }

      const id = readSessionId(token, options.secret);
      if (id === undefined) {
        state.destroyed = true;
        return;
      }

      const session = await store.get(id);
      if (session === undefined || session.expiresAt <= Date.now()) {
        state.destroyed = true;
        return;
      }

      state.session = session;
      if (options.rolling) {
        const extended = Object.freeze({
          ...session,
          expiresAt: Date.now() + options.ttlMs,
        });
        await store.set(extended);
        state.session = extended;
        state.touched = true;
      }
    })
    .onAfterHandle("global", (context) => {
      const state = storage.getStore();
      if (state === undefined) {
        return;
      }
      const cookie = context.cookie[options.cookieName];

      if (state.destroyed) {
        cookie.remove();
        return;
      }
      if (state.session === undefined || (!state.started && !state.touched)) {
        return;
      }

      cookie.set({
        value: issueSessionToken(state.session.id, options.secret),
        httpOnly: true,
        secure: options.cookie.secure,
        sameSite: options.cookie.sameSite,
        path: options.cookie.path,
        maxAge: Math.max(1, Math.ceil((state.session.expiresAt - Date.now()) / 1_000)),
        ...(options.cookie.domain === undefined ? {} : { domain: options.cookie.domain }),
      });
    });
}

function resolveOptions(options: SessionModuleOptions): ResolvedSessionOptions {
  const cookieName = options.cookieName ?? "aponia.sid";
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const maxSessions = options.maxSessions ?? defaultMaxSessions;
  const cookie = options.cookie ?? {};
  const issues: string[] = [];

  if (typeof options.secret !== "string" || options.secret.length < 32) {
    issues.push("secret must be a string of at least 32 characters");
  }
  if (cookieName.trim() === "") {
    issues.push("cookieName must be a non-empty string");
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 1) {
    issues.push("ttlMs must be a positive integer");
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    issues.push("maxSessions must be a positive integer");
  }
  if (cookie.secure !== undefined && typeof cookie.secure !== "boolean") {
    issues.push("cookie.secure must be a boolean");
  }
  if (cookie.sameSite !== undefined && !["lax", "strict", "none"].includes(cookie.sameSite)) {
    issues.push('cookie.sameSite must be "lax", "strict", or "none"');
  }
  if (cookie.path !== undefined && cookie.path.trim() === "") {
    issues.push("cookie.path must be a non-empty string");
  }
  if (cookie.domain !== undefined && cookie.domain.trim() === "") {
    issues.push("cookie.domain must be a non-empty string");
  }
  if (options.rolling !== undefined && typeof options.rolling !== "boolean") {
    issues.push("rolling must be a boolean");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_SESSION_OPTIONS",
      `The session registration is invalid: ${issues.join("; ")}.`,
      { issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({
    secret: options.secret,
    cookieName,
    ttlMs,
    maxSessions,
    cookie: Object.freeze({
      secure: cookie.secure ?? true,
      sameSite: cookie.sameSite ?? "lax",
      path: cookie.path ?? "/",
      domain: cookie.domain,
    }),
    rolling: options.rolling ?? false,
  });
}
