import { AponiaError, Inject, Injectable } from "@aponiajs/common";
import { HTTP_OPTIONS } from "../module/http-module.constants.ts";
import { assertPublicHttpUrl, safeUrl } from "../security/ssrf.ts";
import type {
  HttpRequestOptions,
  HttpResponse,
  ResolvedHttpOptions,
} from "./http-service.types.ts";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const idempotentMethods = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const retryAfterCapMs = 30_000;

/** The SSRF-safe HTTP client an application injects. */
@Injectable()
export class HttpService {
  readonly #options: ResolvedHttpOptions;

  constructor(@Inject(HTTP_OPTIONS) options: ResolvedHttpOptions) {
    this.#options = options;
  }

  /** Sends one request and returns its parsed answer. */
  request<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.#request<T>(url, options);
  }

  /** Sends a GET request. */
  get<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.#request<T>(url, { ...options, method: "GET" });
  }

  /** Sends a POST request. */
  post<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.#request<T>(url, { ...options, method: "POST" });
  }

  /** Sends a PUT request. */
  put<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.#request<T>(url, { ...options, method: "PUT" });
  }

  /** Sends a PATCH request. */
  patch<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.#request<T>(url, { ...options, method: "PATCH" });
  }

  /** Sends a DELETE request. */
  delete<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.#request<T>(url, { ...options, method: "DELETE" });
  }

  async #request<T>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    if (options.json !== undefined && options.body !== undefined) {
      throw invalidOptions("json and body cannot both be supplied");
    }

    const method = (options.method ?? "GET").toUpperCase();
    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;
    const retries = options.retries ?? this.#options.retries;
    const maxResponseBytes = options.maxResponseBytes ?? this.#options.maxResponseBytes;
    const maxRedirects = options.maxRedirects ?? this.#options.maxRedirects;
    const redirect = options.redirect ?? "follow";
    if (options.idempotencyKey !== undefined) {
      if (typeof options.idempotencyKey !== "string" || options.idempotencyKey.trim() === "") {
        throw invalidOptions("idempotencyKey must be a non-empty string");
      }
    }
    assertPositiveInteger(timeoutMs, "timeoutMs");
    assertNonNegativeInteger(retries, "retries");
    assertPositiveInteger(maxResponseBytes, "maxResponseBytes");
    assertNonNegativeInteger(maxRedirects, "maxRedirects");

    let current: URL;
    try {
      current = new URL(url, this.#options.baseUrl);
    } catch {
      throw invalidOptions(`invalid URL "${url}"`);
    }
    if (options.query !== undefined) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          current.searchParams.set(key, String(value));
        }
      }
    }

    const headers = new Headers(this.#options.headers);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value);
    }
    if (headers.has("host")) {
      throw invalidOptions("a Host header cannot be supplied");
    }
    if (options.idempotencyKey !== undefined && !headers.has("idempotency-key")) {
      headers.set("idempotency-key", options.idempotencyKey);
    }

    let body: string | Uint8Array | undefined;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    } else if (options.body !== undefined) {
      body = options.body;
    }

    let redirects = 0;
    for (;;) {
      await assertPublicHttpUrl(current, {
        allowPrivateNetworks: this.#options.allowPrivateNetworks,
        resolveAddresses: this.#options.resolveAddresses,
      });

      const response = await this.#fetchWithRetry(
        current,
        { method, headers, body, signal: options.signal },
        method,
        retries,
        timeoutMs,
        options.idempotencyKey !== undefined,
      );

      if (redirect === "manual" || !redirectStatuses.has(response.status)) {
        return this.#toResponse<T>(response, current, maxResponseBytes, options, redirects > 0);
      }
      if (redirect === "error") {
        throw new AponiaError(
          "HTTP_CLIENT_FAILED",
          "The outbound request answered with a redirect.",
          {
            status: response.status,
            url: safeUrl(current),
          },
        );
      }
      if (body !== undefined) {
        throw new AponiaError(
          "HTTP_CLIENT_FAILED",
          "A redirect with a request body is not followed.",
          { status: response.status, url: safeUrl(current) },
        );
      }
      if (redirects >= maxRedirects) {
        throw new AponiaError(
          "HTTP_CLIENT_FAILED",
          "The outbound request exceeded its redirect limit.",
          {
            status: response.status,
            url: safeUrl(current),
            maxRedirects,
          },
        );
      }

      const location = response.headers.get("location");
      if (location === null) {
        return this.#toResponse<T>(response, current, maxResponseBytes, options, redirects > 0);
      }
      current = new URL(location, current);
      redirects += 1;
    }
  }

  async #fetchWithRetry(
    url: URL,
    init: RequestInit,
    method: string,
    retries: number,
    timeoutMs: number,
    retryAnyMethod: boolean,
  ): Promise<Response> {
    const canRetry = (idempotentMethods.has(method) || retryAnyMethod) && retries > 0;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onCallerAbort = (): void => controller.abort(init.signal?.reason);
      init.signal?.addEventListener("abort", onCallerAbort, { once: true });

      try {
        const response = await this.#options.fetch(url, {
          ...init,
          signal: controller.signal,
          redirect: "manual",
        });
        if (canRetry && attempt < retries && retryableStatuses.has(response.status)) {
          await response.body?.cancel().catch(() => {});
          await delay(retryAfterDelay(response) ?? this.#options.retryDelayMs * 2 ** attempt);
          continue;
        }
        return response;
      } catch (error) {
        const aborted = timedOut || controller.signal.aborted;
        if (aborted) {
          if (timedOut) {
            throw new AponiaError("HTTP_CLIENT_TIMEOUT", "The outbound request timed out.", {
              url: safeUrl(url),
              timeoutMs,
            });
          }
          throw new AponiaError("HTTP_CLIENT_FAILED", "The outbound request was aborted.", {
            url: safeUrl(url),
          });
        }
        if (canRetry && attempt < retries) {
          await delay(this.#options.retryDelayMs * 2 ** attempt);
          continue;
        }
        throw new AponiaError("HTTP_CLIENT_FAILED", "The outbound request failed.", {
          url: safeUrl(url),
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener("abort", onCallerAbort);
      }
    }
  }

  async #toResponse<T>(
    response: Response,
    url: URL,
    maxResponseBytes: number,
    options: HttpRequestOptions,
    redirected: boolean,
  ): Promise<HttpResponse<T>> {
    const bytes = await readBody(response, maxResponseBytes, url);
    const contentType = response.headers.get("content-type") ?? "";
    let data: unknown = parseBody(bytes, contentType);

    if (options.validator !== undefined) {
      const result = await options.validator["~standard"].validate(data);
      if (result.issues !== undefined) {
        throw new AponiaError(
          "HTTP_CLIENT_INVALID_RESPONSE",
          "The outbound response did not match its validator.",
          {
            url: safeUrl(url),
            status: response.status,
            issues: Object.freeze(
              result.issues
                .map((issue) => issue.message)
                .filter((message) => message !== undefined),
            ),
          },
        );
      }
      data = result.value;
    }

    if (!response.ok && options.throwOnError !== false) {
      throw new AponiaError(
        "HTTP_CLIENT_FAILED",
        "The outbound request answered with an error status.",
        {
          status: response.status,
          url: safeUrl(url),
        },
      );
    }

    return Object.freeze({
      status: response.status,
      headers: response.headers,
      data: data as T,
      url: safeUrl(url),
      redirected,
    });
  }
}

async function readBody(response: Response, maxBytes: number, url: URL): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AponiaError(
          "HTTP_CLIENT_RESPONSE_TOO_LARGE",
          "The outbound response exceeded its size limit.",
          { url: safeUrl(url), maxResponseBytes: maxBytes },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseBody(bytes: Uint8Array, contentType: string): unknown {
  if (bytes.byteLength === 0) {
    return undefined;
  }
  const text = new TextDecoder().decode(bytes);
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  if (contentType.startsWith("text/") || contentType.includes("application/xml")) {
    return text;
  }
  return bytes;
}

function retryAfterDelay(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, retryAfterCapMs);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.min(Math.max(date - Date.now(), 0), retryAfterCapMs);
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw invalidOptions(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidOptions(`${name} must be a non-negative integer`);
  }
}

function invalidOptions(reason: string): AponiaError {
  return new AponiaError("INVALID_HTTP_OPTIONS", `The HTTP request is invalid: ${reason}.`, {
    issues: Object.freeze([reason]),
  });
}
