import { Injectable } from "@aponiajs/common";
import { HealthCheckError, HealthIndicator } from "./health-indicator.service.ts";
import type { HealthIndicatorResult } from "../interfaces/terminus.interface.ts";

/**
 * Health indicator that checks process heap and RSS memory usage.
 */
@Injectable()
export class MemoryHealthIndicator extends HealthIndicator {
  /**
   * Checks whether `process.memoryUsage().heapUsed` is below `heapUsedThreshold`.
   *
   * @param key - Indicator key in the health result.
   * @param heapUsedThreshold - Maximum allowed heap bytes.
   * @returns The indicator result.
   */
  async checkHeap(key: string, heapUsedThreshold: number): Promise<HealthIndicatorResult> {
    const { heapUsed } = process.memoryUsage();
    const healthy = heapUsed <= heapUsedThreshold;
    const result = this.getStatus(key, healthy, { heapUsed, threshold: heapUsedThreshold });
    if (!healthy) {
      throw new HealthCheckError(`Heap memory exceeded threshold for "${key}".`, result);
    }
    return result;
  }

  /**
   * Checks whether `process.memoryUsage().rss` is below `rssThreshold`.
   *
   * @param key - Indicator key in the health result.
   * @param rssThreshold - Maximum allowed RSS bytes.
   * @returns The indicator result.
   */
  async checkRSS(key: string, rssThreshold: number): Promise<HealthIndicatorResult> {
    const { rss } = process.memoryUsage();
    const healthy = rss <= rssThreshold;
    const result = this.getStatus(key, healthy, { rss, threshold: rssThreshold });
    if (!healthy) {
      throw new HealthCheckError(`RSS memory exceeded threshold for "${key}".`, result);
    }
    return result;
  }
}
