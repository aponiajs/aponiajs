import { statfs } from "node:fs/promises";
import { Injectable } from "@aponiajs/common";
import { HealthCheckError, HealthIndicator } from "./health-indicator.service.ts";
import type { DiskCheckOptions, HealthIndicatorResult } from "../interfaces/terminus.interface.ts";

/**
 * Health indicator that checks filesystem storage usage via `node:fs/promises`.
 */
@Injectable()
export class DiskHealthIndicator extends HealthIndicator {
  /**
   * Checks storage usage for `options.path` against `thresholdPercent` or `threshold`.
   *
   * @param key - Indicator key in the health result.
   * @param options - Path and threshold configuration.
   * @returns The indicator result.
   */
  async checkStorage(key: string, options: DiskCheckOptions): Promise<HealthIndicatorResult> {
    const stats = await statfs(options.path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const used = Math.max(0, total - free);
    const usedPercent = total > 0 ? used / total : 0;

    let healthy = true;
    if (options.thresholdPercent !== undefined) {
      healthy = healthy && usedPercent <= options.thresholdPercent;
    }
    if (options.threshold !== undefined) {
      healthy = healthy && used <= options.threshold;
    }

    const result = this.getStatus(key, healthy, { used, total, usedPercent });
    if (!healthy) {
      throw new HealthCheckError(`Disk usage exceeded threshold for "${key}".`, result);
    }
    return result;
  }
}
