import { Module, provideClass, provideValue, type DynamicModule } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { MetricsRegistry } from "../registry/metrics-registry.ts";
import { MetricsExceptionFilter } from "../runtime/metrics-exception.filter.ts";
import { metricsPlugin } from "../runtime/metrics-plugin.ts";
import type { MetricsModuleOptions } from "../runtime/metrics-plugin.types.ts";

/**
 * Mounts Prometheus metrics on the application's own route table.
 *
 * ```ts
 * const registry = new MetricsRegistry();
 * @Module({ imports: [MetricsModule.register({ registry })] })
 * export class AppModule {}
 *
 * const application = await AponiaFactory.create(AppModule, {
 *   filters: [MetricsExceptionFilter],
 * });
 * ```
 */
@Module({})
export class MetricsModule {
  /** Builds one metrics registration. */
  static register(options: MetricsModuleOptions = {}): DynamicModule {
    const registry =
      options.registry ??
      new MetricsRegistry({
        ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
        ...(options.maxSeriesPerMetric === undefined
          ? {}
          : { maxSeriesPerMetric: options.maxSeriesPerMetric }),
        ...(options.buckets === undefined ? {} : { buckets: options.buckets }),
      });
    const mounted = PluginModule.register(metricsPlugin({ ...options, registry }), {
      key: "metrics",
    });

    return Object.freeze({
      ...mounted,
      providers: Object.freeze([
        ...(mounted.providers ?? []),
        provideValue(MetricsRegistry, registry),
        provideClass(MetricsExceptionFilter, [MetricsRegistry]),
      ]),
      exports: Object.freeze([...(mounted.exports ?? []), MetricsRegistry, MetricsExceptionFilter]),
    });
  }
}
