import type { HealthIndicatorResult } from "../interfaces/terminus.interface.ts";

/**
 * Error thrown by health indicators or `HealthCheckService` when a check fails.
 *
 * Carries `status = 503` and `toResponse()` so every Aponia platform renders
 * the full `HealthCheckResult` body with HTTP `503 Service Unavailable`.
 */
export class HealthCheckError extends Error {
  readonly causes: unknown;
  readonly status = 503;

  constructor(message: string, causes: unknown) {
    super(message);
    this.name = "HealthCheckError";
    this.causes = causes;
  }

  toResponse(): Response {
    return Response.json(this.causes, { status: 503 });
  }
}

/**
 * Session object returned by `HealthIndicatorService.check(key)` (NestJS Terminus v11 API).
 */
export class HealthIndicatorSession<TKey extends string = string> {
  readonly #key: TKey;

  constructor(key: TKey) {
    this.#key = key;
  }

  /** Marks the indicator as `"up"` with optional metadata fields. */
  up(data: Record<string, unknown> = {}): HealthIndicatorResult {
    return { [this.#key]: { status: "up", ...data } };
  }

  /** Marks the indicator as `"down"` with optional metadata fields. */
  down(data: Record<string, unknown> = {}): HealthIndicatorResult {
    return { [this.#key]: { status: "down", ...data } };
  }
}

/**
 * Injectable service for authoring custom health indicators.
 */
export class HealthIndicatorService {
  /** Starts a health check session for `key`. */
  check<TKey extends string>(key: TKey): HealthIndicatorSession<TKey> {
    return new HealthIndicatorSession(key);
  }
}

/**
 * Classic abstract base class for custom health indicators (`getStatus`).
 */
export abstract class HealthIndicator {
  protected getStatus(
    key: string,
    isHealthy: boolean,
    data: Record<string, unknown> = {},
  ): HealthIndicatorResult {
    return {
      [key]: {
        status: isHealthy ? "up" : "down",
        ...data,
      },
    };
  }
}
