import type { RouteContext } from "./route-schema.types.ts";

/**
 * Factory callback generating an argument value from the incoming request context.
 */
export type CustomParamFactory<TData = unknown, TOutput = unknown> = (
  data: TData | undefined,
  context: RouteContext,
) => TOutput;
