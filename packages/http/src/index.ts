/**
 * `@aponiajs/http` — SSRF-safe outbound HTTP.
 *
 * The package owns the client, the module, and the request policy. It blocks
 * private, loopback, link-local, and metadata addresses by default, re-validates
 * every redirect, bounds the response body, and retries only idempotent methods.
 */
export { HttpModule } from "./module/http-module.ts";
export { HTTP_OPTIONS } from "./module/http-module.constants.ts";
export { HttpService } from "./client/http-service.ts";
export type {
  HttpModuleOptions,
  HttpRedirectPolicy,
  HttpRequestOptions,
  HttpResponse,
  ResolvedHttpOptions,
} from "./client/http-service.types.ts";
