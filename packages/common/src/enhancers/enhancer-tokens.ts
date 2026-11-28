import { createToken } from "../tokens/token.ts";
import type { InjectionToken, ClassToken } from "../interfaces/token.interface.ts";
import type { PipeTransform } from "../interfaces/pipe.interface.ts";
import type {
  CanActivate,
  ExceptionFilter,
  Interceptor,
} from "../interfaces/enhancer.interface.ts";

/**
 * One application-level enhancer: the class to resolve, or an instance to use.
 *
 * A class is resolved through the root module, exactly as an enhancer named by
 * a decorator is, so it must be a provider the root can reach. An instance is
 * used as given, which is what lets a test or a plugin hand over a configured
 * object.
 */
export type ApplicationEnhancer<T> = ClassToken<T> | T;

/**
 * What an `APP_*` token carries: one enhancer, or a list of them in run order.
 *
 * A list is one way to state several enhancers under one token. Several
 * `{ provide: APP_GUARD, ... }` entries in one module are also accepted — the
 * four `APP_*` tokens are the only tokens exempt from the duplicate-token rule —
 * and every entry runs in declaration order. An array is expanded in place, so
 * its entries run where the array was declared.
 */
export type ApplicationEnhancerBinding<T> =
  | ApplicationEnhancer<T>
  | readonly ApplicationEnhancer<T>[];

/**
 * The token that declares an application-wide guard.
 *
 * The guard runs on every route the platform mounts, after the `guards` option
 * and before the controller's own declarations. Declare it in a module's
 * providers, which is where a migrated Nest application already writes it:
 *
 * ```ts
 * @Module({
 *   providers: [AuthGuard, { provide: APP_GUARD, useValue: AuthGuard }],
 * })
 * export class AppModule {}
 * ```
 */
export const APP_GUARD: InjectionToken<ApplicationEnhancerBinding<CanActivate>> =
  createToken<ApplicationEnhancerBinding<CanActivate>>("APP_GUARD");

/** The token that declares an application-wide interceptor. */
export const APP_INTERCEPTOR: InjectionToken<ApplicationEnhancerBinding<Interceptor>> =
  createToken<ApplicationEnhancerBinding<Interceptor>>("APP_INTERCEPTOR");

/** The token that declares an application-wide exception filter. */
export const APP_FILTER: InjectionToken<ApplicationEnhancerBinding<ExceptionFilter>> =
  createToken<ApplicationEnhancerBinding<ExceptionFilter>>("APP_FILTER");

/** The token that declares an application-wide pipe. */
export const APP_PIPE: InjectionToken<ApplicationEnhancerBinding<PipeTransform>> =
  createToken<ApplicationEnhancerBinding<PipeTransform>>("APP_PIPE");

/**
 * The four pseudo-provider tokens an application declares enhancers through.
 *
 * They are exempt from the duplicate-token rule because every registration is a
 * separate enhancer, and they are deliberately unreachable through
 * `application.get` and `ModuleRef.get`: a token that names a set of enhancers
 * has no single instance to answer with.
 */
export const applicationEnhancerTokens: ReadonlySet<InjectionToken<unknown>> = Object.freeze(
  new Set<InjectionToken<unknown>>([APP_GUARD, APP_INTERCEPTOR, APP_FILTER, APP_PIPE]),
);

/**
 * Whether a token is one of the four application-enhancer pseudo-providers.
 *
 * @param token - The token to test.
 * @returns Whether the token declares application-wide enhancers.
 */
export function isApplicationEnhancerToken(token: unknown): boolean {
  return applicationEnhancerTokens.has(token as InjectionToken<unknown>);
}
