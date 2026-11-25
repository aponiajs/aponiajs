import {
  AponiaError,
  ConfigurableModuleBuilder,
  ModuleRef,
  createToken,
  provideFactory,
  provideValue,
  type ClassToken,
  type ConfigurableModuleAsyncOptions,
  type DynamicModule,
  type InjectionToken,
  type ModuleImport,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { HttpClient, HttpService } from "./http-client.service.ts";
import type {
  HttpClientFactoryOptions,
  HttpClientInterceptor,
  HttpClientInterceptorFn,
  HttpClientInterceptorLike,
  HttpClientModuleFactoryOptions,
  HttpClientOptions,
  HttpClientRegisterOptions,
  HttpClientRootOptions,
} from "./interfaces/http-client.interface.ts";
import { resolveHttpOptions } from "./http-client.providers.ts";

/** The default client is the `HttpClient` class token; named ones get a string token. */
export function getHttpClientToken(name?: string): string | typeof HttpClient {
  return name ? `HttpClient:${name}` : HttpClient;
}

/** Each `register*()` module's own options; internal, one per registration. */
const CLIENT_INTERCEPTORS = createToken<readonly HttpClientInterceptorLike[]>(
  "HTTP_CLIENT_INTERCEPTORS",
);
const ROOT_INTERCEPTORS_TOP = createToken<readonly HttpClientInterceptorLike[]>(
  "HTTP_CLIENT_ROOT_INTERCEPTORS_TOP",
);

/** The root interceptors a client merges; exported so the root can be tested. */
export const ROOT_INTERCEPTORS = createToken<readonly HttpClientInterceptorLike[]>(
  "HTTP_CLIENT_ROOT_INTERCEPTORS",
);

const clientBuilder = new ConfigurableModuleBuilder<HttpClientFactoryOptions>({
  optionsInjectionToken: "HTTP_CLIENT_OPTIONS",
})
  .setClassMethodName("register")
  .setFactoryMethodName("createHttpClientOptions")
  .setExtras<{
    name?: string;
    isGlobal?: boolean;
    interceptors?: readonly HttpClientInterceptorLike[];
    imports?: readonly ModuleImport[];
  }>(
    { name: undefined, isGlobal: false, interceptors: undefined, imports: undefined },
    (definition, extras) => {
      const token = getHttpClientToken(extras.name);
      return Object.freeze({
        ...definition,
        global: extras.isGlobal ?? false,
        imports: withImports(definition, extras.imports),
        providers: Object.freeze([
          ...(definition.providers ?? []),
          provideValue(CLIENT_INTERCEPTORS, extras.interceptors ?? []),
          createClientProvider(token),
        ]),
        exports: Object.freeze([
          ...((definition.exports ?? []) as readonly Token<unknown>[]),
          token,
        ]),
      });
    },
  )
  .build();

const rootBuilder = new ConfigurableModuleBuilder<HttpClientModuleFactoryOptions>({
  optionsInjectionToken: "HTTP_CLIENT_MODULE_OPTIONS",
})
  .setClassMethodName("forRoot")
  .setFactoryMethodName("createHttpClientModuleOptions")
  .setExtras<{
    interceptors?: readonly HttpClientInterceptorLike[];
    imports?: readonly ModuleImport[];
  }>({ interceptors: undefined, imports: undefined }, (definition, extras) =>
    Object.freeze({
      ...definition,
      // App-wide defaults only work globally: a client module never imports this one.
      global: true,
      imports: withImports(definition, extras.imports),
      providers: Object.freeze([
        ...(definition.providers ?? []),
        provideValue(ROOT_INTERCEPTORS_TOP, extras.interceptors ?? []),
      ]),
    }),
  )
  .build();

/** The generated client registration class, used by `HttpModule`'s `register`. */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = clientBuilder;

/** The generated app-wide registration class, used by `HttpModule`'s `forRoot`. */
export const {
  ConfigurableModuleClass: RootConfigurableModuleClass,
  OPTIONS_TYPE: ROOT_OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE: ROOT_ASYNC_OPTIONS_TYPE,
} = rootBuilder;

/** The client options token, narrowed so a dependency list keeps its value type. */
const CLIENT_OPTIONS_TOKEN: InjectionToken<HttpClientFactoryOptions> =
  clientBuilder.MODULE_OPTIONS_TOKEN as InjectionToken<HttpClientFactoryOptions>;

/** The app-wide defaults token; the value a registration actually provides. */
export const HTTP_CLIENT_MODULE_OPTIONS: InjectionToken<HttpClientModuleFactoryOptions> =
  rootBuilder.MODULE_OPTIONS_TOKEN as InjectionToken<HttpClientModuleFactoryOptions>;

const ROOT_OPTIONS_TOKEN = HTTP_CLIENT_MODULE_OPTIONS;

/** The client options token a registration provides; internal to the registration. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<HttpClientFactoryOptions> = CLIENT_OPTIONS_TOKEN;

/** What `registerAsync()` accepts. */
export type HttpClientAsyncOptions = ConfigurableModuleAsyncOptions<
  HttpClientFactoryOptions,
  "createHttpClientOptions"
> &
  Partial<{
    name: string;
    isGlobal: boolean;
    interceptors: readonly HttpClientInterceptorLike[];
    imports: readonly ModuleImport[];
  }>;

/** What `forRootAsync()` accepts. */
export type HttpClientModuleAsyncOptions = ConfigurableModuleAsyncOptions<
  HttpClientModuleFactoryOptions,
  "createHttpClientModuleOptions"
> &
  Partial<{
    interceptors: readonly HttpClientInterceptorLike[];
    imports: readonly ModuleImport[];
  }>;

/** Implemented by the class `registerAsync({ useClass })` names. */
export interface HttpClientOptionsFactory {
  createHttpClientOptions(): HttpClientFactoryOptions | Promise<HttpClientFactoryOptions>;
}

/** Implemented by the class `forRootAsync({ useClass })` names. */
export interface HttpClientModuleOptionsFactory {
  createHttpClientModuleOptions():
    | HttpClientModuleFactoryOptions
    | Promise<HttpClientModuleFactoryOptions>;
}

export type { HttpClientRegisterOptions, HttpClientRootOptions };

/**
 * Appends the root interceptor provider and its exports to a root registration.
 *
 * The generated definition cannot depend on the generated token inside its own
 * initializer, so the app-wide interceptor provider is completed here.
 *
 * @internal
 */
export function completeRoot(definition: DynamicModule): DynamicModule {
  return Object.freeze({
    ...definition,
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(
        ROOT_INTERCEPTORS,
        [ROOT_INTERCEPTORS_TOP, ROOT_OPTIONS_TOKEN, ModuleRef],
        (
          top: readonly HttpClientInterceptorLike[],
          options: HttpClientModuleFactoryOptions | undefined,
        ) => rootInterceptors(top, options),
      ) as Provider,
    ]),
    exports: Object.freeze([
      ...((definition.exports ?? []) as readonly Token<unknown>[]),
      ROOT_OPTIONS_TOKEN,
      ROOT_INTERCEPTORS,
    ]),
  });
}

function withImports(
  definition: DynamicModule,
  imports: readonly ModuleImport[] | undefined,
): readonly ModuleImport[] {
  return Object.freeze([...new Set([...(definition.imports ?? []), ...(imports ?? [])])]);
}

function createClientProvider(token: string | typeof HttpClient): Provider {
  return provideFactory(
    token as Token<HttpService>,
    [
      CLIENT_OPTIONS_TOKEN,
      CLIENT_INTERCEPTORS,
      { token: ROOT_OPTIONS_TOKEN, optional: true },
      { token: ROOT_INTERCEPTORS, optional: true },
      ModuleRef,
    ],
    async (
      options: HttpClientFactoryOptions,
      topLevel: readonly HttpClientInterceptorLike[],
      defaults: HttpClientModuleFactoryOptions | undefined,
      root: readonly HttpClientInterceptorLike[] | undefined,
      moduleRef: ModuleRef,
    ) => {
      const entries = clientInterceptors(topLevel, options);
      const interceptors = await resolveInterceptors(moduleRef, [...(root ?? []), ...entries]);
      return new HttpService(resolveHttpOptions(merge(defaults, options)), interceptors);
    },
  ) as Provider;
}

function merge(
  defaults: HttpClientModuleFactoryOptions | undefined,
  client: HttpClientFactoryOptions,
): HttpClientOptions {
  return {
    ...defaults,
    ...client,
    headers: { ...defaults?.headers, ...client.headers },
  };
}

function rootInterceptors(
  top: readonly HttpClientInterceptorLike[],
  options: HttpClientModuleFactoryOptions | undefined,
): readonly HttpClientInterceptorLike[] {
  resolveHttpOptions(options ?? {});
  const fromFactory = options?.interceptors;
  if (fromFactory !== undefined && top.length > 0) {
    throw new AponiaError(
      "INVALID_HTTP_OPTIONS",
      "HttpClientModule: interceptors are declared both next to the factory and in its result. Set them in one place.",
      { issues: Object.freeze(["interceptors is set twice"]) },
    );
  }
  return Object.freeze([...top, ...(fromFactory ?? [])]);
}

function clientInterceptors(
  topLevel: readonly HttpClientInterceptorLike[],
  options: HttpClientFactoryOptions,
): readonly HttpClientInterceptorLike[] {
  const fromFactory = options.interceptors;
  if (fromFactory !== undefined && topLevel.length > 0) {
    throw new AponiaError(
      "INVALID_HTTP_OPTIONS",
      "HttpClientModule.registerAsync(): interceptors are declared both next to the factory and in its result. Set them in one place.",
      { issues: Object.freeze(["interceptors is set twice"]) },
    );
  }
  return [...topLevel, ...(fromFactory ?? [])];
}

async function resolveInterceptors(
  moduleRef: ModuleRef,
  entries: readonly HttpClientInterceptorLike[],
): Promise<readonly HttpClientInterceptor[]> {
  const resolved: HttpClientInterceptor[] = [];
  for (const entry of entries) {
    if (isInterceptorClass(entry)) {
      try {
        resolved.push(moduleRef.get(entry, { strict: false }));
      } catch {
        try {
          resolved.push(moduleRef.create(entry));
        } catch {
          // An interceptor with no provider is constructed with no dependencies;
          // one that needs dependencies is registered as a provider.
          resolved.push(new (entry as unknown as new () => HttpClientInterceptor)());
        }
      }
      continue;
    }
    if (typeof entry === "function") {
      const fn = entry as HttpClientInterceptorFn;
      resolved.push({ intercept: (request, next) => fn(request, next) });
      continue;
    }
    resolved.push(entry);
  }
  return Object.freeze(resolved);
}

function isInterceptorClass(
  entry: HttpClientInterceptorLike,
): entry is ClassToken<HttpClientInterceptor> {
  return (
    typeof entry === "function" &&
    typeof (entry as { readonly prototype?: { readonly intercept?: unknown } }).prototype
      ?.intercept === "function"
  );
}
