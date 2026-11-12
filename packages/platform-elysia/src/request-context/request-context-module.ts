import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { type DynamicModule, type InjectionToken, Module, provideValue } from "@aponiajs/common";
import { Elysia } from "elysia";
import { ELYSIA_PLUGIN } from "../plugins/plugin-module.ts";
import { resolveRequestId } from "./request-context-header.ts";
import { RequestContextService } from "./request-context.service.ts";
import type { RequestContext, RequestContextModuleOptions } from "./request-context.types.ts";

const REQUEST_CONTEXT_MODULE_ID = "AponiaRequestContextModule";

/**
 * One registration per normalized header.
 *
 * `AuthModule` and `TenantModule` both import `forRoot()`; without this cache,
 * each call allocated its own `AsyncLocalStorage` and a fresh `instanceId`, so
 * the graph kept two modules while Elysia mounted only the first plugin. The
 * second module's service then read a storage nobody entered.
 */
const requestContextModules = new Map<string, DynamicModule>();

class InMemoryRequestContext implements RequestContext {
  readonly #values = new Map<symbol, unknown>();

  constructor(
    readonly request: Request,
    readonly requestId: string,
  ) {}

  get<T>(key: InjectionToken<T>): T | undefined {
    return this.#values.get(key.id) as T | undefined;
  }

  set<T>(key: InjectionToken<T>, value: T): void {
    this.#values.set(key.id, value);
  }
}

/**
 * Opt-in dynamic module establishing a per-request AsyncLocalStorage context.
 */
@Module({})
export class RequestContextModule {
  /**
   * Configures and returns the dynamic module providing `RequestContextService`
   * and mounting the request-phase lifecycle hook.
   *
   * Repeated calls for the same normalized header return the first registration;
   * its generator and echo policy win. Use one request-context registration per
   * application: a second header would create a second storage that no single
   * `RequestContextService` token could disambiguate.
   *
   * @param options - Configuration for request ID header name, generator, and echo policy.
   * @returns The dynamic module to import into the application's root module.
   */
  static forRoot(options: RequestContextModuleOptions = {}): DynamicModule {
    const headerName = (options.header ?? "x-request-id").toLowerCase();
    const existing = requestContextModules.get(headerName);
    if (existing !== undefined) {
      return existing;
    }

    const storage = new AsyncLocalStorage<RequestContext>();
    const service = new RequestContextService(storage);

    const generate = options.generate ?? randomUUID;
    const echo = options.echo !== false;

    const plugin = new Elysia({ name: "aponia:request-context", seed: headerName }).onRequest(
      ({ request, set }) => {
        const incomingId = request.headers.get(headerName);
        const requestId = resolveRequestId(incomingId, generate);

        if (echo) {
          set.headers[headerName] = requestId;
        }

        const context = new InMemoryRequestContext(request, requestId);
        storage.enterWith(context);
      },
    );

    const dynamicModule = Object.freeze({
      module: RequestContextModule,
      id: REQUEST_CONTEXT_MODULE_ID,
      instanceId: Symbol.for(`${REQUEST_CONTEXT_MODULE_ID}:${headerName}`),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(RequestContextService, service),
        provideValue(ELYSIA_PLUGIN, plugin),
      ]),
      exports: Object.freeze([RequestContextService]),
    });
    requestContextModules.set(headerName, dynamicModule);
    return dynamicModule;
  }
}
