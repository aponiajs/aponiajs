import { createToken, type InjectionToken } from "@aponiajs/common";

/**
 * The token that injects the current request object.
 *
 * Mirrors Nest's `REQUEST`: a request-scoped consumer receives the object the
 * platform opened the request with.
 */
export const REQUEST: InjectionToken<unknown> = createToken<unknown>("REQUEST");

/**
 * The token that injects the active request context.
 *
 * The context is the object `ContextIdFactory` produced for the request; it
 * carries the context id and the payload a durable strategy attached.
 */
export const CONTEXT: InjectionToken<unknown> = createToken<unknown>("CONTEXT");

/**
 * The token that injects the provider that asked for this dependency.
 *
 * The value resolves lazily, because the inquirer is still under construction
 * at the moment its dependency is injected.
 */
export const INQUIRER: InjectionToken<unknown> = createToken<unknown>("INQUIRER");

/**
 * The request property a context id is recorded on.
 *
 * A platform that already produced a context id for a request writes it here,
 * so `ContextIdFactory.getByRequest` answers the same id for the whole request.
 */
export const REQUEST_CONTEXT_ID: unique symbol = Symbol.for("aponia.request.context.id");

/** The identity one request's dependency-injection sub-tree is built under. */
export interface ContextId {
  /** The identifier; object identity is what the container keys by. */
  readonly id: number | string;
  /** Resolves the parent context id a durable tree is shared under. */
  getParent?: ContextIdResolverFn;
  /** The payload a durable strategy attached. */
  payload?: unknown;
}

/** What a strategy reads about the host component whose context is resolved. */
export interface HostComponentInfo {
  /** The token of the provider or controller being resolved. */
  readonly token: unknown;
  /** Whether the provider's dependency tree declares `durable: true`. */
  readonly isTreeDurable: boolean;
}

/** Resolves the parent context id for one host component. */
export type ContextIdResolverFn = (info: HostComponentInfo) => ContextId;

/** A strategy attachment that also carries a payload for the parent id. */
export interface ContextIdResolver {
  /** The payload recorded on the child context id. */
  readonly payload: unknown;
  /** Resolves the parent context id for one host component. */
  readonly resolve: ContextIdResolverFn;
}

/**
 * Attaches a parent context id to a request's own context id.
 *
 * A durable provider's instance is keyed by the parent a strategy returns, so
 * two requests that map to the same parent share that provider's sub-tree.
 */
export interface ContextIdStrategy<TRequest = unknown> {
  /**
   * Attaches a parent context id to the child generated for one request.
   *
   * @param contextId - The fresh per-request context id.
   * @param request - The request object.
   * @returns A resolver, a resolver with a payload, or nothing.
   */
  attach(
    contextId: ContextId,
    request: TRequest,
  ): ContextIdResolverFn | ContextIdResolver | undefined;
}

/** Creates a fresh, object-identity-unique context id. */
function createContextId(): ContextId {
  return { id: Math.random() };
}

/**
 * The context-id factory Nest exposes.
 *
 * A context id is an object, because the container keys its request-scoped
 * caches by reference: two ids with the same number are still two sub-trees.
 */
export class ContextIdFactory {
  static #strategy: ContextIdStrategy<never> | undefined;

  /**
   * Generates a context identifier.
   *
   * @returns A fresh context id.
   */
  static create(): ContextId {
    return createContextId();
  }

  /**
   * Reads the context id a request already carries, or attaches a fresh one.
   *
   * @param request - The request object.
   * @param propsToInspect - Nested request properties a context id may ride on.
   * @returns The request's context id.
   */
  static getByRequest<TRequest extends Record<PropertyKey, unknown>>(
    request: TRequest,
    propsToInspect: readonly string[] = ["raw"],
  ): ContextId {
    if (request === undefined || request === null) {
      return createContextId();
    }
    const direct = request[REQUEST_CONTEXT_ID];
    if (isContextId(direct)) {
      return direct;
    }
    for (const key of propsToInspect) {
      const nested = (request as Record<string, unknown>)[key];
      if (typeof nested === "object" && nested !== null) {
        const candidate = (nested as Record<PropertyKey, unknown>)[REQUEST_CONTEXT_ID];
        if (isContextId(candidate)) {
          return candidate;
        }
      }
    }
    const strategy = ContextIdFactory.#strategy;
    if (strategy === undefined) {
      return createContextId();
    }
    const contextId = createContextId();
    const attachment = strategy.attach(contextId, request as never);
    if (attachment === undefined) {
      return contextId;
    }
    if (typeof attachment === "function") {
      contextId.getParent = attachment;
      return contextId;
    }
    contextId.getParent = attachment.resolve;
    contextId.payload = attachment.payload;
    return contextId;
  }

  /**
   * Registers the strategy durable providers resolve their parent through.
   *
   * @param strategy - The strategy; only one may be active per process.
   */
  static apply<TRequest = unknown>(strategy: ContextIdStrategy<TRequest>): void {
    ContextIdFactory.#strategy = strategy as ContextIdStrategy<never>;
  }

  /** Removes the registered strategy; a test that applied one restores the default. */
  static reset(): void {
    ContextIdFactory.#strategy = undefined;
  }
}

/**
 * Records a context id on a request object.
 *
 * @param request - The request to annotate.
 * @param contextId - The context id the request resolves under.
 * @returns The same request.
 */
export function attachRequestContextId<TRequest extends object>(
  request: TRequest,
  contextId: ContextId,
): TRequest {
  Object.defineProperty(request, REQUEST_CONTEXT_ID, {
    value: contextId,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return request;
}

function isContextId(value: unknown): value is ContextId {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    (typeof (value as { readonly id?: unknown }).id === "number" ||
      typeof (value as { readonly id?: unknown }).id === "string")
  );
}
