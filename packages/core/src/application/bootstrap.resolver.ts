import {
  getCatchMetadata,
  type ClassToken,
  type ExceptionFilter,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import type { AponiaContainer } from "../injector/container.ts";
import type { ResolvedFilter } from "@aponiajs/common";
import type { GatewayPlan } from "@aponiajs/common";
import {
  collectApplicationEnhancerEntries,
  resolveApplicationEnhancer,
} from "./application-enhancers.ts";

/**
 * Resolves every declaration of one application-enhancer token.
 *
 * The declarations are collected from every module in registration order and
 * each class is resolved in the module that declared it. A class no module
 * provides is refused with `MISSING_PROVIDER`; there is no fallback that
 * constructs it with no dependencies.
 *
 * @internal
 */
export function resolveGlobal<T>(container: AponiaContainer, token: Token<unknown>): readonly T[] {
  return Object.freeze(
    collectApplicationEnhancerEntries<T>(container, token).map((occurrence) =>
      resolveApplicationEnhancer(container, occurrence),
    ),
  );
}

/** @internal */
export function resolveClasses<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  classes: readonly ClassToken<unknown>[],
): readonly T[] {
  return Object.freeze(classes.map((entry) => resolveInstance<T>(container, module, entry)));
}

/** @internal */
export function resolveGatewayFilters(
  container: AponiaContainer,
  module: ModuleDefinition,
  plan: GatewayPlan,
): ReadonlyMap<string, readonly ResolvedFilter[]> {
  const resolve = (classes: readonly ClassToken<unknown>[]): readonly ResolvedFilter[] =>
    Object.freeze(
      resolveClasses<ExceptionFilter>(container, module, classes).map((instance) =>
        Object.freeze({
          instance,
          exceptions: getCatchMetadata(instance.constructor as ClassToken<unknown>),
        }),
      ),
    );
  const classFilters = resolve(plan.filters ?? []);
  const byEvent = new Map<string, readonly ResolvedFilter[]>();
  for (const handler of plan.handlers) {
    const merged = Object.freeze([...resolve(handler.filters ?? []), ...classFilters]);
    if (merged.length > 0) {
      byEvent.set(handler.event, merged);
    }
  }
  return byEvent;
}

function resolveInstance<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  entry: unknown,
): T {
  if (typeof entry === "function") {
    return container.resolveModuleProvider(module, entry as Token<unknown>) as T;
  }
  return entry as T;
}
