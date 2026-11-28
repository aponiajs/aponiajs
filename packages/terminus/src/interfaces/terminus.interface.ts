import type { InjectionToken, ModuleMetadata } from "@aponiajs/common";

/** Status of a single health indicator. */
export type HealthIndicatorStatus = "up" | "down";

/** Result returned by a single health indicator check. */
export type HealthIndicatorResult = Record<
  string,
  {
    readonly status: HealthIndicatorStatus;
    readonly [optionalKeys: string]: unknown;
  }
>;

/** Overall status of a `HealthCheckResult`. */
export type HealthCheckStatus = "error" | "ok" | "shutting_down";

/** Aggregated response payload produced by `HealthCheckService.check()`. */
export interface HealthCheckResult {
  readonly status: HealthCheckStatus;
  readonly info?: HealthIndicatorResult;
  readonly error?: HealthIndicatorResult;
  readonly details: HealthIndicatorResult;
}

/** Async or sync health indicator function passed to `HealthCheckService.check()`. */
export type HealthIndicatorFunction = () => Promise<HealthIndicatorResult> | HealthIndicatorResult;

/** Options for `HttpHealthIndicator` checks. */
export interface HttpCheckOptions {
  readonly timeout?: number;
  readonly headers?: Record<string, string>;
  readonly method?: string;
}

/** Options for `DiskHealthIndicator.checkStorage()`. */
export interface DiskCheckOptions {
  /** Filesystem path to inspect (e.g. `"/"`). */
  readonly path: string;
  /** Maximum used fraction between `0` and `1` (e.g. `0.9` for 90%). */
  readonly thresholdPercent?: number;
  /** Maximum used bytes allowed before reporting `"down"`. */
  readonly threshold?: number;
}

/** Options accepted by `TerminusModule.forRoot()`. */
export interface TerminusModuleOptions {
  /** Graceful shutdown timeout in ms before reporting shutting down. */
  readonly gracefulShutdownTimeoutMs?: number;
}

/** Async options accepted by `TerminusModule.forRootAsync()`. */
export interface TerminusModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  readonly useFactory: (
    ...args: readonly never[]
  ) => TerminusModuleOptions | Promise<TerminusModuleOptions>;
  readonly inject?: readonly InjectionToken<unknown>[];
}
