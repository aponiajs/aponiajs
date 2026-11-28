import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import {
  HTTP_CLIENT_MODULE_OPTIONS,
  HttpClient,
  HttpModule,
  HttpService,
  InjectHttpClient,
  MODULE_OPTIONS_TOKEN,
  getHttpClientToken,
  type HttpClientInterceptor,
  type HttpClientRequest,
  type HttpHandler,
  type HttpClientFactoryOptions,
} from "./index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

const publicResolver = async (): Promise<readonly string[]> => ["93.184.216.34"];

@Injectable()
class ClientOptionsFactory {
  createHttpClientOptions(): { readonly timeoutMs: number } {
    return Object.freeze({ timeoutMs: 1_000 });
  }
}

@Injectable()
class ExistingClientOptionsFactory {
  createHttpClientOptions(): { readonly timeoutMs: number } {
    return Object.freeze({ timeoutMs: 2_000 });
  }
}

@Injectable()
class RootOptionsFactory {
  createHttpClientModuleOptions(): { readonly timeoutMs: number } {
    return Object.freeze({ timeoutMs: 3_000 });
  }
}

@Injectable()
class HeaderInterceptor implements HttpClientInterceptor {
  async intercept(request: HttpClientRequest, next: HttpHandler) {
    return await next({
      ...request,
      options: {
        ...request.options,
        headers: { ...request.options.headers, "x-intercepted": "yes" },
      },
    });
  }
}

describe("HttpModule registration contract", () => {
  test("forRoot registers app-wide defaults and no client", () => {
    const definition = HttpModule.forRoot({ timeoutMs: 1_000 });

    expect(pluginRegistrationIssues(HttpModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, HttpModule)).toEqual([]);
    expect(optionsTokenIssues(definition, HTTP_CLIENT_MODULE_OPTIONS)).toEqual([]);
    expect(definition.global).toBe(true);
    expect(providesClient(definition)).toBe(false);
  });

  test("register creates the default client under the HttpClient token", () => {
    const definition = HttpModule.register({ timeoutMs: 1_000 });

    // The client's options token is internal; the client token is its public surface.
    expect(dynamicModuleIssues(definition, HttpModule)).toEqual([]);
    expect(providesClient(definition)).toBe(true);
    expect(definition.exports).toContain(HttpClient);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        HttpModule.register({ name: "first" }),
        HttpModule.register({ name: "second" }),
        HttpModule,
      ),
    ).toEqual([]);
  });

  test("a named registration creates a distinct client token", () => {
    const definition = HttpModule.register({ name: "github", timeoutMs: 1_000 });

    expect(getHttpClientToken("github")).toBe("HttpClient:github");
    expect(getHttpClientToken()).toBe(HttpClient);
    expect(definition.exports).toContain("HttpClient:github");
    expect(definition.exports).not.toContain(HttpClient);
  });

  test("isGlobal makes a client visible without an import", () => {
    expect(HttpModule.register({}).global).toBe(false);
    expect(HttpModule.register({ isGlobal: true }).global).toBe(true);
  });

  test("accepts the three asynchronous client shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        HttpModule.registerAsync.bind(HttpModule),
        HttpModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);

    const factory = HttpModule.registerAsync({
      useFactory: async () => ({ timeoutMs: 1_000 }),
    });
    const useClass = HttpModule.registerAsync({ useClass: ClientOptionsFactory });
    const useExisting = HttpModule.registerAsync({ useExisting: ExistingClientOptionsFactory });

    for (const definition of [factory, useClass, useExisting]) {
      expect(providesClient(definition)).toBe(true);
    }
  });

  test("forRootAsync accepts useClass and registers no client", () => {
    expect(
      asyncRegistrationShapeIssues(
        HttpModule.forRootAsync.bind(HttpModule),
        HttpModule,
        HTTP_CLIENT_MODULE_OPTIONS,
      ),
    ).toEqual([]);

    const definition = HttpModule.forRootAsync({ useClass: RootOptionsFactory });

    expect(definition.global).toBe(true);
    expect(providesClient(definition)).toBe(false);
  });

  test("the default and a named client are distinct instances", async () => {
    const fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch;

    @Module({
      imports: [
        HttpModule.register({ fetch, resolveAddresses: publicResolver }),
        HttpModule.register({
          name: "github",
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(application.get(HttpClient)).toBe(application.get(HttpService));
    expect(application.get(getHttpClientToken("github"))).not.toBe(application.get(HttpClient));
  });

  test("@InjectHttpClient resolves the named client and root defaults merge", async () => {
    const seen: Headers[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    @Controller("http")
    class HttpController {
      constructor(@InjectHttpClient("github") private readonly client: HttpService) {}

      @Get()
      async read(): Promise<unknown> {
        return (await this.client.get("https://api.example.com/data")).data;
      }
    }

    @Module({
      imports: [
        HttpModule.forRoot({
          headers: { "x-root": "yes" },
          interceptors: [new HeaderInterceptor()],
          resolveAddresses: publicResolver,
        }),
        HttpModule.register({
          name: "github",
          headers: { "x-client": "yes" },
          fetch,
          resolveAddresses: publicResolver,
        }),
      ],
      controllers: [HttpController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/http"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.get("x-root")).toBe("yes");
    expect(seen[0]?.get("x-client")).toBe("yes");
    expect(seen[0]?.get("x-intercepted")).toBe("yes");
  });

  test("a client factory can contribute an interceptor function", async () => {
    const seen: Headers[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers));
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;

    @Module({
      imports: [
        HttpModule.registerAsync({
          useFactory: async (): Promise<HttpClientFactoryOptions> => ({
            fetch,
            resolveAddresses: publicResolver,
            interceptors: [
              async (request, next) =>
                await next({
                  ...request,
                  options: {
                    ...request.options,
                    headers: { ...request.options.headers, "x-factory": "yes" },
                  },
                }),
            ],
          }),
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    await application.get(HttpClient).get("https://api.example.com");

    expect(seen[0]?.get("x-factory")).toBe("yes");
  });

  test("an invalid client option fails the boot, not the registration call", async () => {
    @Module({ imports: [HttpModule.register({ timeoutMs: 0 })] })
    class AppModule {}

    expect(HttpModule.register({ timeoutMs: 0 }).module).toBe(HttpModule);
    let failure: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("INVALID_HTTP_OPTIONS");
  });

  test("refuses a base URL with credentials or one that is not absolute", async () => {
    for (const [baseUrl, issue] of [
      ["https://user:secret@example.com", "baseUrl cannot carry credentials"],
      ["not a url", "baseUrl must be an absolute URL"],
      ["ftp://example.com", "baseUrl must use http or https"],
    ] as const) {
      @Module({ imports: [HttpModule.register({ baseUrl })] })
      class AppModule {}

      let failure: unknown;
      try {
        await AponiaFactory.create(AppModule, { logger: false });
      } catch (error) {
        failure = error;
      }

      expect((failure as AponiaError).code).toBe("INVALID_HTTP_OPTIONS");
      expect((failure as AponiaError).details?.issues as readonly string[]).toContain(issue);
    }
  });

  test("refuses interceptors declared both beside the root factory and in its result", async () => {
    @Module({
      imports: [
        HttpModule.forRootAsync({
          interceptors: [new HeaderInterceptor()],
          useFactory: () => ({ interceptors: [new HeaderInterceptor()] }),
        }),
      ],
    })
    class AppModule {}

    let failure: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      failure = error;
    }

    expect((failure as AponiaError).code).toBe("INVALID_HTTP_OPTIONS");
    expect((failure as AponiaError).details).toEqual({ issues: ["interceptors is set twice"] });
  });

  test("refuses interceptors declared both beside the client factory and in its result", async () => {
    @Module({
      imports: [
        HttpModule.registerAsync({
          interceptors: [new HeaderInterceptor()],
          useFactory: () => ({
            fetch: (async () => new Response("{}")) as unknown as typeof globalThis.fetch,
            resolveAddresses: publicResolver,
            interceptors: [new HeaderInterceptor()],
          }),
        }),
      ],
    })
    class AppModule {}

    let failure: unknown;
    let booted: AponiaApplication | undefined;
    try {
      booted = await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      failure = error;
    }
    await booted?.close();

    expect((failure as AponiaError).code).toBe("INVALID_HTTP_OPTIONS");
  });

  test("an interceptor instance runs as it was declared", async () => {
    const seen: Headers[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers));
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;

    @Module({
      imports: [
        HttpModule.register({
          fetch,
          resolveAddresses: publicResolver,
          interceptors: [new HeaderInterceptor()],
        }),
      ],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    await application.get(HttpClient).get("https://api.example.com");

    expect(seen[0]?.get("x-intercepted")).toBe("yes");
  });
});

function providesClient(definition: { readonly providers?: readonly unknown[] }): boolean {
  return (definition.providers ?? []).some((provider) => {
    const token = (provider as { readonly provide?: unknown }).provide;
    return token === HttpClient || token === HttpService;
  });
}
