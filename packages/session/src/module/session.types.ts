/** Session data, keyed by the application. */
export interface Session<TData extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly data: TData;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** The storage contract a session registration accepts. */
export interface SessionStore {
  get(id: string): Session | undefined | Promise<Session | undefined>;
  set(session: Session): void | Promise<void>;
  delete(id: string): boolean | Promise<boolean>;
  clear(): void | Promise<void>;
}

/** Cookie attributes a session registration accepts. */
export interface SessionCookieOptions {
  readonly secure?: boolean;
  readonly sameSite?: "lax" | "strict" | "none";
  readonly path?: string;
  readonly domain?: string;
}

/** Options a session registration accepts. */
export interface SessionModuleOptions {
  /** The HMAC secret; at least 32 characters. */
  readonly secret: string;
  /** The cookie name; defaults to `aponia.sid`. */
  readonly cookieName?: string;
  /** The absolute lifetime in milliseconds; defaults to 24 hours. */
  readonly ttlMs?: number;
  /** The store to use; defaults to a bounded in-memory store. */
  readonly store?: SessionStore;
  /** The in-memory store's cap; ignored when `store` is supplied. */
  readonly maxSessions?: number;
  /** Cookie attributes. */
  readonly cookie?: SessionCookieOptions;
  /** Whether a session's lifetime is extended on each read; defaults to false. */
  readonly rolling?: boolean;
  /** The plugin module identity; defaults to `session`. */
  readonly key?: string;
}

/** The validated options the service and plugin read. */
export interface ResolvedSessionOptions {
  readonly secret: string;
  readonly cookieName: string;
  readonly ttlMs: number;
  readonly maxSessions: number;
  readonly cookie: Readonly<{
    readonly secure: boolean;
    readonly sameSite: "lax" | "strict" | "none";
    readonly path: string;
    readonly domain: string | undefined;
  }>;
  readonly rolling: boolean;
}
