import type { Constructor, Token, TokenMap } from "@aponiajs/common";
import type { TestApplication } from "./test-application.ts";

/**
 * The four ways a test replaces one provider, named after Nest's `overrideProvider`.
 *
 * Each returns the builder, so a case reads as one chain:
 * `createTestApplication(AppModule).overrideProvider(UsersService).useValue(stub).compile()`.
 */
export interface TestProviderOverride<T> {
  /** Supplies the value every read of the token resolves to. */
  useValue(value: T): TestApplicationBuilder;
  /**
   * Builds the value once per boot, from the dependencies named in `inject`.
   *
   * `inject` is optional and defaults to none, which is the common case: a test
   * factory that returns a stub from its own closure needs nothing resolved.
   */
  useFactory<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    factory: (...dependencies: TokenMap<TDependencies>) => T,
    inject?: TDependencies,
  ): TestApplicationBuilder;
  /**
   * Substitutes a class for the token, constructed with the named dependencies.
   *
   * The dependency list is stated rather than read from decorator metadata,
   * because a substituted class is often a hand-written stub with none, and a
   * class whose constructor takes arguments and no decorator is refused by the
   * compiler rather than constructed with `undefined`.
   */
  useClass<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    useClass: Constructor<T, TokenMap<TDependencies>>,
    inject?: TDependencies,
  ): TestApplicationBuilder;
  /** Points the token at another token the graph already provides. */
  useExisting(existing: Token<T>): TestApplicationBuilder;
}

/**
 * A test application that has not booted yet.
 *
 * The overrides have to be declared before anything is compiled — replacing a
 * provider is a rewrite of the compiled graph — so the boot is the last step
 * rather than the first.
 */
export interface TestApplicationBuilder {
  /**
   * Replaces one provider for the application this builder will boot.
   *
   * The application's own module is never touched: the rewrite happens on the
   * compiled descriptors, in this builder's own memory. A token no module in the
   * graph provides fails `compile()` with `MISSING_PROVIDER`.
   */
  overrideProvider<T>(token: Token<T>): TestProviderOverride<T>;
  /** Compiles the graph, applies the overrides, and boots the application. */
  compile(): Promise<TestApplication>;
}
