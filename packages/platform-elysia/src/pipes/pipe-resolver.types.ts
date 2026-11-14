import type { PipeTransform } from "@aponiajs/common";

/**
 * A resolved pipe instance ready for runtime execution.
 */
export interface ResolvedPipe {
  /** The pipe instance implementing PipeTransform. */
  readonly instance: PipeTransform;
}

/**
 * Resolved pipes grouped by parameter index for a route.
 */
export type ParameterPipesMap = ReadonlyMap<number, readonly ResolvedPipe[]>;
