import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  getCatchMetadata,
  type ApplicationEnhancer,
  type ApplicationEnhancerBinding,
  type CanActivate,
  type ClassToken,
  type ExceptionFilter,
  type Interceptor,
  type ModuleDefinition,
  type PipeTransform,
  type Token,
} from "@aponiajs/common";
import type { AponiaContainer } from "../injector/container.ts";

/**
 * One application-enhancer declaration, with the module that declared it.
 *
 * The module travels beside the entry because a class is resolved in the scope
 * it was declared in, exactly as a route-level class is: a class the declaring
 * module cannot reach raises `MISSING_PROVIDER` rather than being constructed
 * with no dependencies.
 *
 * @internal
 */
export interface ApplicationEnhancerOccurrence<T> {
  readonly module: ModuleDefinition;
  readonly entry: ApplicationEnhancer<T>;
}

/**
 * Every declaration of one application-enhancer token, in run order.
 *
 * A module may declare the same `APP_*` token more than once — the four tokens
 * are the only ones exempt from the duplicate-token rule — and an entry may be
 * an array. Collection walks the compiled modules in graph order and each
 * module's providers in declaration order, so the result is the order the
 * application declared. An array is expanded where it was declared.
 *
 * @param container - The booted container.
 * @param token - The `APP_*` token to collect.
 * @returns The declarations, in run order.
 *
 * @internal
 */
export function collectApplicationEnhancerEntries<T>(
  container: AponiaContainer,
  token: Token<unknown>,
): readonly ApplicationEnhancerOccurrence<T>[] {
  const occurrences: ApplicationEnhancerOccurrence<T>[] = [];
  for (const module of container.graph.modules) {
    for (const provider of module.providers) {
      if (provider.provide !== token) {
        continue;
      }
      const value = container.resolveProvider<ApplicationEnhancerBinding<T> | undefined>(
        module,
        provider,
      );
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          occurrences.push(Object.freeze({ module, entry }));
        }
      } else {
        occurrences.push(Object.freeze({ module, entry: value as ApplicationEnhancer<T> }));
      }
    }
  }
  return Object.freeze(occurrences);
}

/**
 * Resolves one declaration to the instance that runs.
 *
 * A class is resolved in its declaring module; a class the module cannot reach
 * is refused with the same `MISSING_PROVIDER` a missing dependency raises. There
 * is deliberately no fallback that constructs the class with no dependencies.
 *
 * @internal
 */
export function resolveApplicationEnhancer<T>(
  container: AponiaContainer,
  occurrence: ApplicationEnhancerOccurrence<T>,
): T {
  const { module, entry } = occurrence;
  if (typeof entry === "function") {
    return container.resolveModuleProvider(module, entry as Token<unknown>) as T;
  }
  return entry as T;
}

/** The application-wide guards, in declaration order. */
export function resolveApplicationGuards(container: AponiaContainer): readonly CanActivate[] {
  return Object.freeze(
    collectApplicationEnhancerEntries<CanActivate>(container, APP_GUARD).map((occurrence) =>
      resolveApplicationEnhancer(container, occurrence),
    ),
  );
}

/** The application-wide interceptors, in declaration order. */
export function resolveApplicationInterceptors(container: AponiaContainer): readonly Interceptor[] {
  return Object.freeze(
    collectApplicationEnhancerEntries<Interceptor>(container, APP_INTERCEPTOR).map((occurrence) =>
      resolveApplicationEnhancer(container, occurrence),
    ),
  );
}

/** One application-wide filter with the exception types it declared. */
export interface ResolvedApplicationFilter {
  readonly instance: ExceptionFilter;
  readonly catch: readonly Token<unknown>[];
}

/** The application-wide filters, in declaration order. */
export function resolveApplicationFilters(
  container: AponiaContainer,
): readonly ResolvedApplicationFilter[] {
  return Object.freeze(
    collectApplicationEnhancerEntries<ExceptionFilter>(container, APP_FILTER).map((occurrence) => {
      const instance = resolveApplicationEnhancer(container, occurrence);
      const token = (
        typeof occurrence.entry === "function"
          ? occurrence.entry
          : (instance.constructor as ClassToken<unknown>)
      ) as ClassToken<unknown>;
      return Object.freeze({ instance, catch: getCatchMetadata(token) });
    }),
  );
}

/** The application-wide pipes, in declaration order. */
export function resolveApplicationPipeOccurrences(
  container: AponiaContainer,
): readonly ApplicationEnhancerOccurrence<PipeTransform>[] {
  return collectApplicationEnhancerEntries<PipeTransform>(container, APP_PIPE);
}
