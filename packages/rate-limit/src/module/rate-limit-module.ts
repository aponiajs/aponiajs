import {
  AponiaError,
  Module,
  Reflector,
  provideClass,
  provideValue,
  type DynamicModule,
} from "@aponiajs/common";
import { RateLimitGuard } from "../guard/rate-limit.guard.ts";
import type { RateLimitOptions, ResolvedRateLimitOptions } from "./rate-limit.types.ts";
import { RateLimitService } from "../service/rate-limit.service.ts";
import { MemoryRateLimitStore } from "../store/memory-rate-limit-store.ts";
import { RATE_LIMIT_OPTIONS, RATE_LIMIT_STORE } from "./rate-limit-module.constants.ts";

const defaultLimit = 60;
const defaultWindowMs = 60_000;
const defaultMaxKeys = 10_000;

/**
 * Provides the rate-limit service, guard, and store.
 *
 * Import the registration in the module whose controllers declare
 * `@UseGuards(RateLimitGuard)`, or import it at the root and pass the guard to
 * `AponiaFactory.create({ guards: [RateLimitGuard] })`.
 */
@Module({})
export class RateLimitModule {
  /**
   * Builds a rate-limit registration.
   *
   * @param options - The limit, window, store, key cap, and default bucket key.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_RATE_LIMIT` when an option is invalid.
   */
  static register(options: RateLimitOptions = {}): DynamicModule {
    const resolved = resolveOptions(options);
    const store = options.store ?? new MemoryRateLimitStore({ maxKeys: resolved.maxKeys });

    return Object.freeze({
      module: RateLimitModule,
      id: "RateLimitModule",
      instanceId: Symbol("RateLimitModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(RATE_LIMIT_STORE, store),
        provideValue(RATE_LIMIT_OPTIONS, resolved),
        provideClass(RateLimitService, [RATE_LIMIT_STORE, RATE_LIMIT_OPTIONS]),
        provideClass(Reflector, []),
        provideClass(RateLimitGuard, [RateLimitService, Reflector, RATE_LIMIT_OPTIONS]),
      ]),
      exports: Object.freeze([RateLimitService, RateLimitGuard]),
    });
  }
}

function resolveOptions(options: RateLimitOptions): ResolvedRateLimitOptions {
  const limit = options.limit ?? defaultLimit;
  const windowMs = options.windowMs ?? defaultWindowMs;
  const maxKeys = options.maxKeys ?? defaultMaxKeys;
  const issues: string[] = [];

  if (!Number.isInteger(limit) || limit < 1) {
    issues.push("limit must be a positive integer");
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    issues.push("windowMs must be a positive integer");
  }
  if (!Number.isInteger(maxKeys) || maxKeys < 1) {
    issues.push("maxKeys must be a positive integer");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_RATE_LIMIT",
      `The rate-limit registration is invalid: ${issues.join("; ")}.`,
      { issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({ limit, windowMs, maxKeys, key: options.key });
}
