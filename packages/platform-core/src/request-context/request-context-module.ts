import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  AponiaError,
  createToken,
  Injectable,
  registerAsyncContextExit,
  provideValue,
  type DynamicModule,
  type InjectionToken,
} from "@aponiajs/common";
import { LifetimeScope, type Scoped } from "@aponiajs/compiler";
import { resolveRequestId } from "./request-context-header.ts";
import type {
  RequestContext,
  RequestContextModuleOptions,
  RequestContextRegistration,
} from "./request-context.types.ts";

/**
 * One registration per normalized header.
 *
 * `AuthModule` and `TenancyModule` both import `forRoot()`; without this cache
 * each call allocates its own storage and `instanceId`, and the graph keeps two
 * modules while a platform installs one hook.
 */
const requestContextModules = new Map<string, DynamicModule>();

/** The token a boot locates the request-context registration through. */
export const REQUEST_CONTEXT_REGISTRATION = createToken<RequestContextRegistration>(
  "AponiaRequestContextRegistration",
);

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
 * An injectable singleton service providing access to the current request's
 * context store.
 */
@Injectable()
export class RequestContextService {
  readonly #storage: AsyncLocalStorage<RequestContext>;
  readonly #scopes = new WeakMap<RequestContext, LifetimeScope>();
  readonly #contexts = new WeakMap<Request, RequestContext>();

  constructor(storage?: AsyncLocalStorage<RequestContext>) {
    this.#storage = storage ?? new AsyncLocalStorage<RequestContext>();
    registerAsyncContextExit((work) => this.#storage.exit(work));
  }

  /** Retrieves the context of the in-flight request, or `undefined` outside one. */
  current(): RequestContext | undefined {
    return this.#storage.getStore();
  }

  /**
   * Opens the lifetime of one request context.
   *
   * Idempotent: an already-open context keeps its scope.
   *
   * @internal
   */
  open(context: RequestContext): void {
    this.#contexts.set(context.request, context);
    this.#scopeFor(context);
  }

  /**
   * Returns a handle that refuses a read after the request boundary.
   *
   * This is the safe accessor. `current()` keeps its compatibility behavior.
   *
   * @returns A scoped handle to the in-flight request context.
   * @throws An `AponiaError` with `MISSING_REQUEST_CONTEXT` outside a request.
   */
  scoped(): Scoped<RequestContext> {
    const context = this.current();
    if (context === undefined) {
      throw new AponiaError(
        "MISSING_REQUEST_CONTEXT",
        "Cannot open a scoped request context outside of an active request.",
      );
    }
    return this.#scopeFor(context).track(context);
  }

  /**
   * Ends the lifetime of one request context, revoking its handles.
   *
   * With no argument the ambient context is released. Idempotent, and safe to
   * call from both the response hook and the wrapper's `handle` finally.
   *
   * @param request - The request whose context to release.
   */
  release(request?: Request): void {
    const context = request === undefined ? this.current() : this.#contexts.get(request);
    if (context === undefined) {
      return;
    }
    this.#scopes.get(context)?.exit("request-complete");
  }

  /**
   * Whether a context's lifetime is still open.
   *
   * A context no request opened is treated as open, so a direct `run()` keeps
   * its previous behavior.
   *
   * @internal
   */
  isActive(context: object): boolean {
    return this.#scopes.get(context as RequestContext)?.isOpen ?? true;
  }

  /** Runs work inside one request's context store. */
  run<T>(context: RequestContext, work: () => T): T {
    return this.#storage.run(context, work);
  }

  /** Enters one request's context for the rest of the current async chain. */
  enterWith(context: RequestContext): void {
    this.#storage.enterWith(context);
  }

  #scopeFor(context: RequestContext): LifetimeScope {
    let scope = this.#scopes.get(context);
    if (scope === undefined) {
      scope = new LifetimeScope({ label: `request:${context.requestId}` });
      this.#scopes.set(context, scope);
      this.#contexts.set(context.request, context);
    }
    return scope;
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
