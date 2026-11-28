import { Injectable } from "@aponiajs/common";
import { HealthCheckError } from "../health-indicators/health-indicator.service.ts";
import type {
  HealthCheckResult,
  HealthIndicatorFunction,
  HealthIndicatorResult,
} from "../interfaces/terminus.interface.ts";

/**
 * Executes an array of health indicator functions and aggregates their results
 * into a NestJS Terminus `HealthCheckResult`.
 */
@Injectable()
export class HealthCheckService {
  /**
   * Runs every indicator in parallel and returns a `HealthCheckResult` when all
   * are `"up"`. Throws `HealthCheckError` (HTTP 503) if any indicator fails or
   * reports `"down"`.
   *
   * @param healthIndicators - Indicator callbacks to run.
   * @returns Aggregated `HealthCheckResult`.
   */
  async check(healthIndicators: readonly HealthIndicatorFunction[]): Promise<HealthCheckResult> {
    const info: HealthIndicatorResult = {};
    const error: HealthIndicatorResult = {};
    const details: HealthIndicatorResult = {};
    let hasError = false;

    const settled = await Promise.all(
      healthIndicators.map(async (indicator, index) => {
        try {
          return { ok: true as const, value: await indicator() };
        } catch (err) {
          if (err instanceof HealthCheckError && isIndicatorResult(err.causes)) {
            return { ok: true as const, value: err.causes };
          }
          const fallbackKey = `indicator_${index}`;
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false as const,
            value: { [fallbackKey]: { status: "down" as const, message } },
          };
        }
      }),
    );

    for (const entry of settled) {
      if (!entry.ok) {
        hasError = true;
      }
      for (const [key, result] of Object.entries(entry.value)) {
        details[key] = result;
        if (result.status === "up") {
          info[key] = result;
        } else {
          hasError = true;
          error[key] = result;
        }
      }
    }

    const payload: HealthCheckResult = {
      status: hasError ? "error" : "ok",
      info,
      error,
      details,
    };

    if (hasError) {
      throw new HealthCheckError("Health check failed", payload);
    }

    return payload;
  }
}

function isIndicatorResult(value: unknown): value is HealthIndicatorResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entries = Object.values(value);
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "status" in entry &&
        (entry.status === "up" || entry.status === "down"),
    )
  );
}
