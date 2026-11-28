import {
  AponiaError,
  Module,
  Reflector,
  provideClass,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { RateLimitGuard } from "../guard/rate-limit.guard.ts";
import { RateLimitService } from "../service/rate-limit.service.ts";
import { MemoryRateLimitStore } from "../store/memory-rate-limit.store.ts";
import { RATE_LIMIT_OPTIONS, RATE_LIMIT_STORE } from "./rate-limit-module.constants.ts";
import type { RateLimitOptions, RegistrationRateLimitOptions } from "./rate-limit.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type RateLimitModuleExtras,
  type RateLimitModuleRegistrationAsyncOptions,
  type RateLimitModuleSyncOptions,
} from "./rate-limit.module-definition.ts";

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
export class RateLimitModule extends ConfigurableModuleClass {
  /**
   * Builds a rate-limit registration.
   *
   * @param options - The limit, window, store, key cap, and default bucket key.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_RATE_LIMIT` when an option is invalid.
   */
  static forRoot(options: RateLimitModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options));
  }

  /**
   * Builds a rate-limit registration whose options a factory, a class, or an
   * existing provider resolves.
   *
   * The options are resolved once when the options token first resolves, and
   * validated then, so a refused boot names the same issues `forRoot` reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: RateLimitModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return registration(super.registerAsync(options), options.extraProviders);
  }

  /**
   * Builds a rate-limit registration.
   *
   * @deprecated Use {@link RateLimitModule.forRoot}; retained for the beta line.
   */
  static override register(options: RateLimitModuleSyncOptions = {}): DynamicModule {
    return RateLimitModule.forRoot(options);
  }

  /**
   * Builds a rate-limit registration whose options a factory resolves.
   *
   * @deprecated Use {@link RateLimitModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(options: RateLimitModuleRegistrationAsyncOptions): DynamicModule {
    return RateLimitModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: RateLimitModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(RATE_LIMIT_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: RateLimitOptions) =>
        resolveOptions(options),
      ),
      provideFactory(
        RATE_LIMIT_STORE,
        [RATE_LIMIT_OPTIONS],
        (options: RegistrationRateLimitOptions) =>
          options.store ?? new MemoryRateLimitStore({ maxKeys: options.maxKeys }),
      ),
      provideClass(RateLimitService, [RATE_LIMIT_STORE, RATE_LIMIT_OPTIONS]),
      provideClass(Reflector, []),
      provideClass(RateLimitGuard, [RateLimitService, Reflector, RATE_LIMIT_OPTIONS]),
      ...extraProviders,
    ]),
    exports: Object.freeze([MODULE_OPTIONS_TOKEN, RateLimitService, RateLimitGuard]),
  });
}

function assertExtras(options: Partial<RateLimitModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw new AponiaError(
      "INVALID_RATE_LIMIT",
      "The rate-limit registration is invalid: isGlobal must be a boolean.",
      { issues: Object.freeze(["isGlobal must be a boolean"]) },
    );
  }
}

function resolveOptions(options: RateLimitOptions): RegistrationRateLimitOptions {
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
  if (options.key !== undefined && typeof options.key !== "function") {
    issues.push("key must be a function");
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_RATE_LIMIT",
      `The rate-limit registration is invalid: ${issues.join("; ")}.`,
      { issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({ limit, windowMs, maxKeys, key: options.key, store: options.store });
}
