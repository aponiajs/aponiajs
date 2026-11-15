import type { InjectionToken } from "@aponiajs/common";

/**
 * An immutable per-request context established during the request phase.
 */
export interface RequestContext {
  /** The incoming standard Request being served. */
  readonly request: Request;

  /** The unique correlation identifier for this request. */
  readonly requestId: string;

  /**
   * Retrieves a typed value stored under an injection token for this request.
   */
  get<T>(key: InjectionToken<T>): T | undefined;

  /**
   * Stores a typed value under an injection token for this request.
   */
  set<T>(key: InjectionToken<T>, value: T): void;
}

/**
 * Options configuring `RequestContextModule.forRoot()`.
 */
export interface RequestContextModuleOptions {
  /**
   * The HTTP header name to read the request ID from and echo on the response.
   * @default "x-request-id"
   */
  readonly header?: string;

  /**
   * A generator function producing a fallback request ID when missing or invalid.
   * @default crypto.randomUUID
   */
  readonly generate?: () => string;

  /**
   * Whether to echo the resolved request ID back on the response headers.
   * @default true
   */
  readonly echo?: boolean;
}
