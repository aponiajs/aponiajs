import { AponiaError, Inject, Injectable, Optional } from "@aponiajs/common";
import { CONFIGURATION_TOKEN } from "./config.constants.ts";
import type { ConfigObject } from "./interfaces/config-module.interface.ts";

/**
 * Nest-compatible configuration service for reading typed environment variables
 * and namespaced configuration objects via dot-notation paths.
 */
@Injectable()
export class ConfigService<K = ConfigObject> {
  readonly #internalConfig: ConfigObject;
  readonly #cache = new Map<string, unknown>();
  readonly #useCache: boolean;

  constructor(
    @Optional()
    @Inject(CONFIGURATION_TOKEN)
    internalConfig: ConfigObject = {},
    useCache = false,
  ) {
    this.#internalConfig = internalConfig;
    this.#useCache = useCache;
  }

  /**
   * Reads a configuration value by dot-notation path (e.g. `"database.host"` or `"PORT"`).
   *
   * @param propertyPath - Dot-separated key path.
   * @returns The value if present, or `undefined`.
   */
  get<T = unknown>(propertyPath: keyof K & string): T | undefined;
  /**
   * Reads a configuration value by dot-notation path with a fallback default.
   *
   * @param propertyPath - Dot-separated key path.
   * @param defaultValue - Value returned when the key resolves to `undefined`.
   * @returns The resolved value or `defaultValue`.
   */
  get<T = unknown>(propertyPath: keyof K & string, defaultValue: T): T;
  get<T = unknown>(propertyPath: string, defaultValue?: T): T | undefined;
  get<T = unknown>(propertyPath: string, defaultValue?: T): T | undefined {
    if (this.#useCache && this.#cache.has(propertyPath)) {
      const cached = this.#cache.get(propertyPath) as T | undefined;
      return cached !== undefined ? cached : defaultValue;
    }

    const resolved = this.#resolvePath(propertyPath);
    if (this.#useCache && resolved !== undefined) {
      this.#cache.set(propertyPath, resolved);
    }

    return resolved !== undefined ? (resolved as T) : defaultValue;
  }

  /**
   * Reads a configuration value by dot-notation path, throwing `AponiaError` if missing.
   *
   * @param propertyPath - Dot-separated key path.
   * @returns The resolved non-undefined value.
   * @throws `AponiaError` (`INVALID_CONFIGURATION_VALUE`) when the key is missing.
   */
  getOrThrow<T = unknown>(propertyPath: keyof K & string): T;
  /**
   * Reads a configuration value or returns `defaultValue` if present; throws if both are `undefined`.
   */
  getOrThrow<T = unknown>(propertyPath: keyof K & string, defaultValue: T): T;
  getOrThrow<T = unknown>(propertyPath: string, defaultValue?: T): T;
  getOrThrow<T = unknown>(propertyPath: string, defaultValue?: T): T {
    const value = this.get<T>(propertyPath, defaultValue as T);
    if (value === undefined) {
      throw new AponiaError(
        "INVALID_CONFIGURATION_VALUE",
        `Configuration key "${propertyPath}" does not exist.`,
        { configuration: "ConfigService", key: propertyPath },
      );
    }
    return value;
  }

  #resolvePath(propertyPath: string): unknown {
    // Check direct key first (e.g., flat env var like "DATABASE_URL")
    if (Object.prototype.hasOwnProperty.call(this.#internalConfig, propertyPath)) {
      const direct = this.#internalConfig[propertyPath];
      if (direct !== undefined) {
        return direct;
      }
    }

    const segments = propertyPath.split(".");
    let current: unknown = this.#internalConfig;
    for (const segment of segments) {
      if (typeof current !== "object" || current === null) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (current !== undefined) {
      return current;
    }

    return process.env[propertyPath];
  }
}
