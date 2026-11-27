/**
 * Token for raw internal configuration merged from `.env`, `process.env`, and `load` factories.
 */
export const CONFIGURATION_TOKEN = Symbol.for("aponia.config.internal");

/**
 * Prefix applied to namespaced configuration tokens created by `registerAs`.
 */
export const CONFIGURATION_LOADER = Symbol.for("aponia.config.loader");

/**
 * Token holding the resolved `ConfigModuleOptions`.
 */
export const CONFIG_MODULE_OPTIONS = Symbol.for("aponia.config.options");

/**
 * Returns the DI injection token for a configuration namespace registered with `registerAs`.
 *
 * @param key - The namespace name passed to `registerAs`.
 * @returns A deterministic string token matching `CONFIGURATION(<key>)`.
 */
export function getConfigToken(key: string): string {
  return `CONFIGURATION(${key})`;
}
