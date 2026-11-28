/**
 * `@aponiajs/http` — SSRF-safe outbound HTTP.
 *
 * The package owns the client, the module, and the request policy. It blocks
 * private, loopback, link-local, and metadata addresses by default, re-validates
 * every redirect, bounds the response body, and retries only idempotent methods.
 */
export { HttpModule } from "./http.module.ts";
export { HTTP_OPTIONS } from "./http-client.constants.ts";
export {
  HTTP_CLIENT_MODULE_OPTIONS,
  MODULE_OPTIONS_TOKEN,
  ROOT_INTERCEPTORS,
  getHttpClientToken,
  type HttpClientAsyncOptions,
  type HttpClientModuleAsyncOptions,
  type HttpClientModuleOptionsFactory,
  type HttpClientOptionsFactory,
  type HttpClientRegisterOptions,
  type HttpClientRootOptions,
} from "./http.module-definition.ts";
export { HttpClient, HttpService } from "./http-client.service.ts";
export { InjectHttpClient } from "./inject-http-client.decorator.ts";
export { BulkheadLimiter, type BulkheadOptions } from "./resilience/bulkhead.ts";
export {
  OriginCircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from "./resilience/circuit-breaker.ts";
export type {
  HttpHandler,
  HttpClientFactoryOptions,
  HttpClientInterceptor,
  HttpClientInterceptorFn,
  HttpClientInterceptorLike,
  HttpClientModuleFactoryOptions,
  HttpClientModuleOptions,
  HttpClientOptions,
  HttpClientRegistrationExtras,
  HttpClientRequest,
} from "./interfaces/http-client.interface.ts";
export type {
  HttpModuleAsyncOptions,
  HttpModuleOptions,
  HttpRedirectPolicy,
  HttpRequestOptions,
  HttpResponse,
  ResolvedHttpOptions,
} from "./interfaces/http-service.interface.ts";
