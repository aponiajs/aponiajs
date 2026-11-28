import type { InjectionToken } from "./token.interface.ts";

/** An immutable per-request context established during the request phase. */
export interface RequestContext {
  /** The incoming standard `Request` being served. */
  readonly request: Request;
  /** The unique correlation identifier for this request. */
  readonly requestId: string;
  /** Retrieves a typed value stored under an injection token for this request. */
  get<T>(key: InjectionToken<T>): T | undefined;
  /** Stores a typed value under an injection token for this request. */
  set<T>(key: InjectionToken<T>, value: T): void;
}

/** Options configuring `RequestContextModule.forRoot()`. */
export interface RequestContextModuleOptions {
  /** The header the request ID is read from and echoed on; defaults to `x-request-id`. */
  readonly header?: string;
  /** Produces a request ID when the header is missing or invalid. */
  readonly generate?: () => string;
  /** Whether the resolved request ID is echoed back; defaults to `true`. */
  readonly echo?: boolean;
}

/** What a platform installs per request to establish the context. */
export interface RequestContextRegistration {
  /** The normalized header name. */
  readonly header: string;
  /** Whether the resolved ID is echoed on the response. */
  readonly echo: boolean;
  /** Produces a request ID when the header is missing or invalid. */
  readonly generate: () => string;
  /** The service the boot exposes as the request-context accessor. */
  readonly service: {
    current(): object | undefined;
    isActive(context: object): boolean;
  };
  /** Runs one request's work inside the context store. */
  run<T>(
    request: Request,
    setHeader: (name: string, value: string) => void,
    work: () => Promise<T>,
  ): Promise<T>;
  /** Enters the request's context for the rest of the current async chain. */
  enter(request: Request, setHeader: (name: string, value: string) => void): void;
  /** Ends the request's lifetime; safe to call more than once. */
  release(request?: Request): void;
}
