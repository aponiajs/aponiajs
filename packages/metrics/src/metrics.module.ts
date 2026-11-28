import {
  AponiaError,
  Module,
  provideFactory,
  provideRequestLifecycleHooksAsync,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import type {
  MetricsModuleOptions,
  ResolvedMetricsOptions,
} from "./interfaces/metrics.interface.ts";
import { createMetricsLifecycleHook } from "./metrics-lifecycle.provider.ts";
import { DEFAULT_HTTP_BUCKETS, METRICS_OPTIONS } from "./metrics.constants.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type MetricsModuleRegistrationAsyncOptions,
  type MetricsModuleSyncOptions,
} from "./metrics.module-definition.ts";
import { MetricsService } from "./metrics.service.ts";

/**
 * Registers Prometheus metrics collection and the optional `/metrics` endpoint.
 */
@Module({})
export class MetricsModule extends ConfigurableModuleClass {
  static forRoot(options: MetricsModuleSyncOptions = {}): DynamicModule {
    resolveMetricsOptions(options);
    return registration(super.register(options));
  }

  static forRootAsync(options: MetricsModuleRegistrationAsyncOptions): DynamicModule {
    return registration(super.registerAsync(options), options.extraProviders);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: MetricsModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(METRICS_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: MetricsModuleOptions) =>
        resolveMetricsOptions(options),
      ),
      provideFactory(
        MetricsService,
        [METRICS_OPTIONS],
        (options: ResolvedMetricsOptions) => new MetricsService(options),
      ),
      provideRequestLifecycleHooksAsync([METRICS_OPTIONS, MetricsService], (options, metrics) =>
        createMetricsLifecycleHook(options, metrics),
      ),
      ...extraProviders,
    ]),
    exports: Object.freeze([...(definition.exports ?? []), MODULE_OPTIONS_TOKEN, MetricsService]),
  });
}

function resolveMetricsOptions(options: MetricsModuleOptions): ResolvedMetricsOptions {
  const path = options.path ?? "/metrics";
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new AponiaError("INVALID_METRICS_OPTIONS", "Metrics path must start with '/'.", {
      status: 500,
    });
  }
  const maxLabelCombinations = options.maxLabelCombinations ?? 2000;
  if (!Number.isInteger(maxLabelCombinations) || maxLabelCombinations <= 0) {
    throw new AponiaError(
      "INVALID_METRICS_OPTIONS",
      "maxLabelCombinations must be a positive integer.",
      { status: 500 },
    );
  }
  const httpBuckets = options.httpBuckets ?? DEFAULT_HTTP_BUCKETS;
  if (httpBuckets.some((bucket) => !Number.isFinite(bucket) || bucket <= 0)) {
    throw new AponiaError(
      "INVALID_METRICS_OPTIONS",
      "httpBuckets entries must be positive finite numbers.",
      { status: 500 },
    );
  }
  return Object.freeze({
    path,
    exposeEndpoint: options.exposeEndpoint ?? true,
    collectDefaultMetrics: options.collectDefaultMetrics ?? true,
    collectHttpMetrics: options.collectHttpMetrics ?? true,
    httpBuckets: Object.freeze([...httpBuckets]),
    maxLabelCombinations,
    prefix: options.prefix ?? "",
    authorize: options.authorize,
  });
}
