import { AsyncLocalStorage } from "node:async_hooks";
import { AponiaError, createToken, Injectable, registerAsyncContextExit } from "@aponiajs/common";
import { LifetimeScope, type Scoped } from "@aponiajs/compiler";
import type { RequestContext, RequestContextRegistration } from "@aponiajs/common";

/** The token a boot locates the request-context registration through. */
export const REQUEST_CONTEXT_REGISTRATION = createToken<RequestContextRegistration>(
  "AponiaRequestContextRegistration",
);

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
