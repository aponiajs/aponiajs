import type { ClassToken, ModuleImport } from "@aponiajs/common";
import type {
  HttpModuleOptions,
  HttpRequestOptions,
  HttpResponse,
} from "./http-service.interface.ts";

/** The request a client interceptor sees before the request is sent. */
export interface HttpClientRequest {
  readonly url: string;
  readonly options: HttpRequestOptions;
}

/** The next step in an interceptor chain; calling it sends the request. */
export type HttpHandler = (request: HttpClientRequest) => Promise<HttpResponse<unknown>>;

/** The class form `@nestjs/http-client` publishes; resolved from the container. */
export interface HttpClientInterceptor {
  intercept(request: HttpClientRequest, next: HttpHandler): Promise<HttpResponse<unknown>>;
}

/** The function form an interceptor may take. */
export type HttpClientInterceptorFn = (
  request: HttpClientRequest,
  next: HttpHandler,
) => Promise<HttpResponse<unknown>>;

/** Every shape a registration accepts in `interceptors`. */
export type HttpClientInterceptorLike =
  | HttpClientInterceptor
  | HttpClientInterceptorFn
  | ClassToken<HttpClientInterceptor>;

/** Options one client registration accepts, before structural extras. */
export interface HttpClientOptions extends HttpModuleOptions {}

/** Options `forRoot()` accepts: app-wide defaults, not a client. */
export interface HttpClientModuleOptions extends HttpModuleOptions {}

/** The structural extras one `register()` states. */
export interface HttpClientRegistrationExtras {
  /** The client token name; omitted means the default `HttpClient`. */
  readonly name?: string;
  /** Makes the client injectable everywhere. Defaults to false. */
  readonly isGlobal?: boolean;
  /** Interceptor classes, instances, and functions. */
  readonly interceptors?: readonly HttpClientInterceptorLike[];
  /** Modules whose exports an interceptor class injects from. */
  readonly imports?: readonly ModuleImport[];
}

/** What `register()` takes: one client and the extras that shape its module. */
export type HttpClientRegisterOptions = HttpClientOptions & HttpClientRegistrationExtras;

/** What `forRoot()` takes: app-wide defaults and the modules its interceptors use. */
export type HttpClientRootOptions = HttpClientModuleOptions & {
  readonly interceptors?: readonly HttpClientInterceptorLike[];
  readonly imports?: readonly ModuleImport[];
};

/** What an async client factory (or `createHttpClientOptions()`) returns. */
export type HttpClientFactoryOptions = Omit<HttpClientOptions, "interceptors"> & {
  readonly interceptors?: readonly (HttpClientInterceptor | HttpClientInterceptorFn)[];
};

/** What an async root factory (or `createHttpClientModuleOptions()`) returns. */
export type HttpClientModuleFactoryOptions = Omit<HttpClientModuleOptions, "interceptors"> & {
  readonly interceptors?: readonly (HttpClientInterceptor | HttpClientInterceptorFn)[];
};
