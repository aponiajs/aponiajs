import { AsyncLocalStorage } from "node:async_hooks";
import {
  AponiaError,
  Module,
  createToken,
  provideClass,
  provideValue,
  type DynamicModule,
  type MiddlewareConsumer,
} from "@aponiajs/common";
import { SessionMiddleware } from "../middleware/session-middleware.ts";
import { SessionService, type SessionRequestState } from "../service/session-service.ts";
import { MemorySessionStore } from "../store/memory-session-store.ts";
import type {
  ResolvedSessionOptions,
  SessionModuleOptions,
  SessionStore,
} from "./session.types.ts";

const defaultTtlMs = 86_400_000;
const defaultMaxSessions = 10_000;

const SESSION_STORAGE =
  createToken<AsyncLocalStorage<SessionRequestState>>("aponia.session.storage");
const SESSION_STORE = createToken<SessionStore>("aponia.session.store");
const SESSION_OPTIONS = createToken<ResolvedSessionOptions>("aponia.session.options");

/** Provides the session service and mounts the cookie middleware. */
@Module({})
export class SessionModule {
  /**
   * Mounts the session middleware ahead of every route.
   *
   * The middleware is a provider the registration exports, so a module's own
   * `configure` can name it and the container resolves the store, storage, and
   * options it runs with.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes("/*");
  }

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
    const moduleKey = options.key ?? "session";

    return Object.freeze({
      module: SessionModule,
      id: `SessionModule[${moduleKey}]`,
      instanceId: Symbol.for(`aponia.session:${moduleKey}`),
      imports: Object.freeze([]),
      providers: Object.freeze([
        provideValue(SESSION_STORAGE, storage),
        provideValue(SESSION_STORE, store),
        provideValue(SESSION_OPTIONS, resolved),
        provideClass(SessionMiddleware, [SESSION_STORAGE, SESSION_STORE, SESSION_OPTIONS]),
        provideValue(SessionService, service),
      ]),
      // The middleware is exported so the root's own `apply` can resolve the
      // request-scoped wiring; the service because a handler injects it.
      exports: Object.freeze([SessionService, SessionMiddleware]),
    });
  }
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
