import { randomUUID } from "node:crypto";
import { provideValue, type DynamicModule, type InjectionToken } from "@aponiajs/common";
import { resolveRequestId } from "./request-context-header.ts";
import { REQUEST_CONTEXT_REGISTRATION, RequestContextService } from "./request-context.service.ts";
import type {
  RequestContext,
  RequestContextModuleOptions,
  RequestContextRegistration,
} from "@aponiajs/common";

/**
 * One registration per normalized header.
 *
 * `AuthModule` and `TenancyModule` both import `forRoot()`; without this cache
 * each call allocates its own storage and `instanceId`, and the graph keeps two
 * modules while a platform installs one hook.
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

class Registration implements RequestContextRegistration {
  readonly header: string;
  readonly echo: boolean;
  readonly generate: () => string;
  readonly service: RequestContextService;

  constructor(options: RequestContextModuleOptions) {
    this.header = (options.header ?? "x-request-id").toLowerCase();
    this.generate = options.generate ?? randomUUID;
    this.echo = options.echo !== false;
    this.service = new RequestContextService();
  }

  async run<T>(
    request: Request,
    setHeader: (name: string, value: string) => void,
    work: () => Promise<T>,
  ): Promise<T> {
    const context = this.#contextOf(request, setHeader);
    this.service.open(context);
    try {
      return await this.service.run(context, work);
    } finally {
      this.service.release(request);
    }
  }

  enter(request: Request, setHeader: (name: string, value: string) => void): void {
    const context = this.#contextOf(request, setHeader);
    this.service.open(context);
    this.service.enterWith(context);
  }

  release(request?: Request): void {
    this.service.release(request);
  }

  #contextOf(request: Request, setHeader: (name: string, value: string) => void): RequestContext {
    const requestId = resolveRequestId(request.headers.get(this.header), this.generate);
    if (this.echo) {
      setHeader(this.header, requestId);
    }
    return new InMemoryRequestContext(request, requestId);
  }
}

/**
 * Opt-in dynamic module establishing a per-request `AsyncLocalStorage` context.
 */
export class RequestContextModule {
  /**
   * Configures and returns the dynamic module providing `RequestContextService`
   * and the registration a platform installs per request.
   *
   * @param options - Header name, generator, and echo policy.
   * @returns The dynamic module to import into the application's root module.
   */
  static forRoot(options: RequestContextModuleOptions = {}): DynamicModule {
    const header = (options.header ?? "x-request-id").toLowerCase();
    const existing = requestContextModules.get(header);
    if (existing !== undefined) {
      return existing;
    }

    const registration = new Registration(options);
    const dynamicModule = Object.freeze({
      module: RequestContextModule,
      id: "AponiaRequestContextModule",
      instanceId: Symbol.for(`AponiaRequestContextModule:${header}`),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(RequestContextService, registration.service),
        provideValue(REQUEST_CONTEXT_REGISTRATION, registration),
      ]),
      exports: Object.freeze([RequestContextService]),
    });
    requestContextModules.set(header, dynamicModule);
    return dynamicModule;
  }
}
