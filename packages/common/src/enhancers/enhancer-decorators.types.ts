import type { ClassToken } from "../tokens/token.types.ts";

/**
 * The enhancers a class or one of its methods declares, in declaration order.
 *
 * Every entry is the class itself. A filter's matched types are not held here:
 * `@Catch(...)` decorates the filter class, so they are read from that class
 * through `getCatchMetadata` when the filter is resolved. Keeping one copy of
 * the fact is what makes `@UseFilters(SomeFilter)` behave the same however it
 * is written.
 *
 * A class-level declaration and a method-level one stay separate, because a
 * method can only add to what its controller already requires: the platform
 * concatenates the two scopes in that order while it compiles a route.
 */
export interface EnhancerMetadata {
  readonly guards: readonly ClassToken<unknown>[];
  readonly interceptors: readonly ClassToken<unknown>[];
  readonly filters: readonly ClassToken<unknown>[];
}
