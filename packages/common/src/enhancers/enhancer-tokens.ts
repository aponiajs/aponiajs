import { createToken } from "../tokens/token.ts";
import type { InjectionToken, ClassToken } from "../tokens/token.types.ts";
import type { PipeTransform } from "../pipes/pipe.types.ts";
import type { CanActivate, ExceptionFilter, Interceptor } from "./enhancer.types.ts";

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
 * A list is how one token states several enhancers. The container registers one
 * provider per token in a module, so several `{ provide: APP_GUARD, ... }`
 * entries are refused as a duplicate provider; provide an array instead.
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
