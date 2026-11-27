import { Injectable } from "@aponiajs/common";
import { HealthCheckError, HealthIndicator } from "./health-indicator.service.ts";
import type { HealthIndicatorResult, HttpCheckOptions } from "../interfaces/terminus.interface.ts";

/**
 * Health indicator that probes an HTTP endpoint with `fetch`.
 */
@Injectable()
export class HttpHealthIndicator extends HealthIndicator {
  /**
   * Sends an HTTP request to `url` and reports `"up"` for 2xx responses.
   *
   * @param key - Indicator key in the health result.
   * @param url - Target URL to probe.
   * @param options - Optional timeout, method, and headers.
   * @returns The indicator result.
   */
  async pingCheck(
    key: string,
    url: string,
    options: HttpCheckOptions = {},
  ): Promise<HealthIndicatorResult> {
    return await this.responseCheck(
      key,
      url,
      (response) => response.status >= 200 && response.status < 300,
      options,
    );
  }

  /**
   * Sends an HTTP request to `url` and validates the response with `callback`.
   *
   * @param key - Indicator key in the health result.
   * @param url - Target URL to probe.
   * @param callback - Predicate inspecting the `Response`.
   * @param options - Optional timeout, method, and headers.
   * @returns The indicator result.
   */
  async responseCheck(
    key: string,
    url: string,
    callback: (response: Response) => boolean | Promise<boolean>,
    options: HttpCheckOptions = {},
  ): Promise<HealthIndicatorResult> {
    const controller = new AbortController();
    const timeoutMs = options.timeout ?? 5000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        signal: controller.signal,
      });
      const healthy = await callback(response);
      if (!healthy) {
        throw new HealthCheckError(
          `HTTP check "${key}" failed with status ${response.status}.`,
          this.getStatus(key, false, { statusCode: response.status }),
        );
      }
      return this.getStatus(key, true, { statusCode: response.status });
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new HealthCheckError(
        `HTTP check "${key}" failed: ${message}`,
        this.getStatus(key, false, { message }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
