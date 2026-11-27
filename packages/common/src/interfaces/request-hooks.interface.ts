/**
 * A neutral observer of the request lifecycle.
 *
 * A package contributes one of these instead of mounting a native hook. The
 * shared pipeline calls them, so a package never touches a native request or
 * response object.
 */
export interface RequestLifecycleHook {
  /** The name a diagnostic and a duplicate check read. */
  readonly name: string;
  /**
   * Runs before routing.
   *
   * A returned `Response` short-circuits the request — an idempotency replay,
   * a rate-limit refusal, an authentication challenge. `undefined` declines
   * and lets the request continue.
   */
  onRequest?(request: Request): Response | undefined | Promise<Response | undefined>;
  /**
   * Wraps the rest of the request as one async scope.
   *
   * Instrumentation that has to be active for the handler — a tracing span, a
   * timing scope — is expressed here rather than in `onRequest`, which cannot
   * keep an asynchronous context open across the dispatch. `next` resolves the
   * request's answer; the hook may observe it and must return it.
   */
  wrap?(request: Request, next: (request: Request) => Promise<Response>): Promise<Response>;
  /** Observes the final response. It cannot replace it. */
  onResponse?(request: Request, response: Response): void | Promise<void>;
  /** Observes a failure before the route's filters and the default mapping. */
  onError?(request: Request, error: unknown): void | Promise<void>;
}
