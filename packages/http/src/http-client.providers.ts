import { AponiaError } from "@aponiajs/common";
import { resolveHostname } from "./security/ssrf.ts";
import type {
  HttpClientModuleOptions,
  HttpClientOptions,
} from "./interfaces/http-client.interface.ts";
import type { ResolvedHttpOptions } from "./interfaces/http-service.interface.ts";

const defaultTimeoutMs = 10_000;
const defaultRetries = 0;
const defaultRetryDelayMs = 100;
const defaultMaxResponseBytes = 1_048_576;
const defaultMaxRedirects = 3;

/**
 * Validates one registration's options and fills the defaults.
 *
 * @internal
 */
export function resolveHttpOptions(options: HttpClientOptions): ResolvedHttpOptions {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const retries = options.retries ?? defaultRetries;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const maxResponseBytes = options.maxResponseBytes ?? defaultMaxResponseBytes;
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
  const issues: string[] = [];

  if (options.baseUrl !== undefined) {
    try {
      const base = new URL(options.baseUrl);
      if (base.protocol !== "http:" && base.protocol !== "https:") {
        issues.push("baseUrl must use http or https");
      }
      if (base.username !== "" || base.password !== "") {
        issues.push("baseUrl cannot carry credentials");
      }
    } catch {
      issues.push("baseUrl must be an absolute URL");
    }
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    issues.push("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) {
    issues.push("retries must be an integer between 0 and 5");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    issues.push("retryDelayMs must be a non-negative integer");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    issues.push("maxResponseBytes must be a positive integer");
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    issues.push("maxRedirects must be an integer between 0 and 10");
  }
  if (options.pinResolvedAddress !== undefined && typeof options.pinResolvedAddress !== "boolean") {
    issues.push("pinResolvedAddress must be a boolean");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_HTTP_OPTIONS",
      `The HTTP registration is invalid: ${issues.join("; ")}.`,
      { issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({
    baseUrl: options.baseUrl,
    headers: Object.freeze({ ...options.headers }),
    timeoutMs,
    retries,
    retryDelayMs,
    maxResponseBytes,
    maxRedirects,
    allowPrivateNetworks: options.allowPrivateNetworks ?? false,
    fetch: options.fetch ?? fetch,
    resolveAddresses: options.resolveAddresses ?? resolveHostname,
    pinResolvedAddress: options.pinResolvedAddress ?? true,
    circuitBreaker: options.circuitBreaker === false ? undefined : options.circuitBreaker,
    bulkhead: options.bulkhead === false ? undefined : options.bulkhead,
  });
}

/**
 * Merges the app-wide defaults with one client's own options.
 *
 * A client's value wins, and the headers merge key by key so a root default
 * header and a client header can both reach the request.
 *
 * @internal
 */
export function mergeHttpOptions(
  defaults: HttpClientModuleOptions | undefined,
  client: HttpClientOptions,
): HttpClientOptions {
  return {
    ...defaults,
    ...client,
    headers: { ...defaults?.headers, ...client.headers },
  };
}
