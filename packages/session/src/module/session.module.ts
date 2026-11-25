import { AsyncLocalStorage } from "node:async_hooks";
import {
  AponiaError,
  Module,
  createToken,
  moduleOptionsProviders,
  provideClass,
  provideFactory,
  provideValue,
  type DynamicModule,
  type MiddlewareConsumer,
  type ModuleAsyncOptions,
  type ModuleImport,
  type Provider,
} from "@aponiajs/common";
import { SessionMiddleware } from "../middleware/session.middleware.ts";
import { SessionService, type SessionRequestState } from "../service/session.service.ts";
import { MemorySessionStore } from "../store/memory-session.store.ts";
import type {
  RegistrationSessionOptions,
  SessionModuleOptions,
  SessionStore,
} from "../interfaces/session.interface.ts";

const defaultTtlMs = 86_400_000;
const defaultMaxSessions = 10_000;

const SESSION_STORAGE =
  createToken<AsyncLocalStorage<SessionRequestState>>("aponia.session.storage");
const SESSION_STORE = createToken<SessionStore>("aponia.session.store");
const SESSION_OPTIONS = createToken<RegistrationSessionOptions>("aponia.session.options");

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
  static forRoot(options: SessionModuleOptions): DynamicModule {
    return registration([provideValue(SESSION_OPTIONS, resolveOptions(options))], options.key);
  }

  /**
   * Builds a session registration whose options a factory resolves.
   *
   * `key` is read from the registration, not from the factory result, because
   * it names the module identity before the container runs.
   *
   * @param options - The imports, injected tokens, factory, key, and extra providers.
   * @returns The module registration an application imports.
   */
  static forRootAsync(
    options: ModuleAsyncOptions<SessionModuleOptions> & { readonly key?: string },
  ): DynamicModule {
    return registration(
      moduleOptionsProviders(SESSION_OPTIONS, options, resolveOptions),
      options.key,
      options.imports,
      options.extraProviders,
    );
  }

  /**
   * Builds a session registration.
   *
   * @deprecated Use {@link SessionModule.forRoot}; retained for the beta line.
   */
  static register(options: SessionModuleOptions): DynamicModule {
    return SessionModule.forRoot(options);
  }
}

function registration(
  optionsProviders: readonly Provider[],
  key: string | undefined,
  imports: readonly ModuleImport[] = [],
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  const moduleKey = key ?? "session";
  return Object.freeze({
    module: SessionModule,
    id: `SessionModule[${moduleKey}]`,
    instanceId: Symbol.for(`aponia.session:${moduleKey}`),
    imports: Object.freeze([...imports]),
    providers: Object.freeze([
      provideValue(SESSION_STORAGE, new AsyncLocalStorage<SessionRequestState>()),
      ...optionsProviders,
      provideFactory(
        SESSION_STORE,
        [SESSION_OPTIONS],
        (options: RegistrationSessionOptions) =>
          options.store ?? new MemorySessionStore({ maxSessions: options.maxSessions }),
      ),
      provideClass(SessionMiddleware, [SESSION_STORAGE, SESSION_STORE, SESSION_OPTIONS]),
      provideFactory(
        SessionService,
        [SESSION_STORAGE, SESSION_STORE, SESSION_OPTIONS],
        (
          storage: AsyncLocalStorage<SessionRequestState>,
          store: SessionStore,
          options: RegistrationSessionOptions,
        ) => new SessionService(storage, store, options),
      ),
      ...extraProviders,
    ]),
    // The middleware is exported so the root's own `apply` can resolve the
    // request-scoped wiring; the service because a handler injects it.
    exports: Object.freeze([SessionService, SessionMiddleware]),
  });
}

function resolveOptions(options: SessionModuleOptions): RegistrationSessionOptions {
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
    store: options.store,
  });
}
