import {
  AponiaError,
  Module,
  provideClass,
  provideValue,
  type DynamicModule,
} from "@aponiajs/common";
import { HttpService } from "../client/http-service.ts";
import type { HttpModuleOptions, ResolvedHttpOptions } from "../client/http-service.types.ts";
import { resolveHostname } from "../security/ssrf.ts";
import { HTTP_OPTIONS } from "./http-module.constants.ts";

const defaultTimeoutMs = 10_000;
const defaultRetries = 0;
const defaultRetryDelayMs = 100;
const defaultMaxResponseBytes = 1_048_576;
const defaultMaxRedirects = 3;

/** Provides one SSRF-safe HTTP client. */
@Module({})
export class HttpModule {
  /**
   * Builds an HTTP registration.
   *
   * @param options - Base URL, headers, limits, fetch, and DNS resolver.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_HTTP_OPTIONS` when an option is invalid.
   */
  static register(options: HttpModuleOptions = {}): DynamicModule {
    const resolved = resolveOptions(options);
    return Object.freeze({
      module: HttpModule,
      id: "HttpModule",
      instanceId: Symbol("HttpModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(HTTP_OPTIONS, resolved),
        provideClass(HttpService, [HTTP_OPTIONS]),
      ]),
      exports: Object.freeze([HttpService]),
    });
  }
}

function resolveOptions(options: HttpModuleOptions): ResolvedHttpOptions {
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
  });
}
