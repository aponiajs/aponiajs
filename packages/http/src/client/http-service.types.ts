import type { StandardSchemaV1 } from "@standard-schema/spec";

/** The redirect policy a request selects. */
export type HttpRedirectPolicy = "follow" | "error" | "manual";

/** Options the HTTP module accepts. */
export interface HttpModuleOptions {
  /** A base URL relative requests resolve against. */
  readonly baseUrl?: string;
  /** Headers sent with every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The request timeout in milliseconds; defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** The number of retries for idempotent methods; defaults to 0. */
  readonly retries?: number;
  /** The base delay between retries; defaults to 100 ms. */
  readonly retryDelayMs?: number;
  /** The maximum response body size; defaults to 1 MiB. */
  readonly maxResponseBytes?: number;
  /** The maximum redirects followed; defaults to 3. */
  readonly maxRedirects?: number;
  /** Allows private, loopback, and link-local addresses; defaults to false. */
  readonly allowPrivateNetworks?: boolean;
  /** The fetch implementation; defaults to the runtime's global `fetch`. */
  readonly fetch?: typeof fetch;
  /** A hostname resolver; defaults to the runtime's DNS lookup. */
  readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
  /**
   * Connects to the validated address instead of letting the runtime resolve the
   * hostname again; defaults to true. Disable only for a custom fetch that pins
   * the address itself.
   */
  readonly pinResolvedAddress?: boolean;
}

/** The validated options the service reads. */
export interface ResolvedHttpOptions {
  readonly baseUrl: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryDelayMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly allowPrivateNetworks: boolean;
  readonly fetch: typeof fetch;
  readonly resolveAddresses: (hostname: string) => Promise<readonly string[]>;
  readonly pinResolvedAddress: boolean;
}

/** Options one request accepts. */
export interface HttpRequestOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly json?: unknown;
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly redirect?: HttpRedirectPolicy;
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
  readonly validator?: StandardSchemaV1<unknown, unknown>;
  /**
   * Sends an `Idempotency-Key` header and makes a retry safe for any method.
   *
   * A POST is not retried by default because the first attempt may have been
   * applied; a key tells the server it can recognise the repeat, so the client
   * retries only when it is stated.
   */
  readonly idempotencyKey?: string;
  /** Throws on a non-2xx answer; defaults to true. */
  readonly throwOnError?: boolean;
}

/** One HTTP answer. */
export interface HttpResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly data: T;
  readonly url: string;
  readonly redirected: boolean;
}
