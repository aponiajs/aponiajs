import type { AponiaHttpApplicationOptions } from "../interfaces/application.interface.ts";
import type { AponiaApplicationSurfaceConfig } from "../interfaces/application.interface.ts";

/**
 * The empty surface configuration a boot starts with.
 *
 * @internal
 */
export function createApplicationSurfaceConfig(): AponiaApplicationSurfaceConfig {
  return {
    guards: [],
    interceptors: [],
    pipes: [],
    filters: [],
    enabled: false,
  };
}

/**
 * Merges a surface configuration into the options a boot re-runs with.
 *
 * Every surface registration appends behind the factory options it repeats, so
 * a surface method can add to a boot's declaration but never replace it. The
 * factory options are the descriptor path and stay first.
 *
 * @internal
 */
export function mergeApplicationSurfaceOptions(
  options: AponiaHttpApplicationOptions,
  surface: AponiaApplicationSurfaceConfig,
): AponiaHttpApplicationOptions {
  return {
    ...options,
    ...(surface.guards.length > 0
      ? { guards: [...(options.guards ?? []), ...surface.guards] }
      : {}),
    ...(surface.interceptors.length > 0
      ? {
          interceptors: [...(options.interceptors ?? []), ...surface.interceptors],
        }
      : {}),
    ...(surface.pipes.length > 0 ? { pipes: [...(options.pipes ?? []), ...surface.pipes] } : {}),
    ...(surface.filters.length > 0
      ? { filters: [...(options.filters ?? []), ...surface.filters] }
      : {}),
    ...(surface.cors === undefined ? {} : { cors: surface.cors }),
    ...(surface.securityHeaders === undefined ? {} : { securityHeaders: surface.securityHeaders }),
    ...(surface.prefix === undefined ? {} : { prefix: surface.prefix }),
    ...(surface.versioning === undefined ? {} : { versioning: surface.versioning }),
    ...(surface.logger === undefined ? {} : { logger: surface.logger }),
  };
}
