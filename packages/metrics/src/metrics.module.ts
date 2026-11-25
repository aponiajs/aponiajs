import {
  Module,
  dynamicModule,
  moduleOptionsProviders,
  provideClass,
  provideFactory,
  provideValue,
  type DynamicModule,
  type ModuleAsyncOptions,
  type ModuleImport,
  type Provider,
} from "@aponiajs/common";
import {
  provideRequestLifecycleHooksAsync,
  requirePlatformCapabilities,
} from "@aponiajs/platform-core";
import { createMetricsInstrumentation } from "./metrics-instrumentation.ts";
import { createMetricsController } from "./metrics.controller.ts";
import { MetricsExceptionFilter } from "./metrics.filter.ts";
import { MetricsRegistry } from "./registry/metrics.registry.ts";
import type { MetricsModuleOptions, ResolvedMetricsOptions } from "./metrics-plugin.types.ts";
import { METRICS_OPTIONS_TOKEN } from "./metrics.constants.ts";

const moduleKey = "metrics";

/**
 * Mounts Prometheus metrics on the application's own route table.
 *
 * ```ts
 * const registry = new MetricsRegistry();
 * @Module({ imports: [MetricsModule.forRoot({ registry })] })
 * export class AppModule {}
 * ```
 *
 * The instrumentation is a neutral `RequestLifecycleHook` and the scrape is a
 * controller, so both run on every platform. `MetricsExceptionFilter` remains
 * exported for an application that wants a filter of its own, but it is
 * redundant beside this registration: the hook records a failure before the
 * route's filters.
 */
@Module({})
export class MetricsModule {
  /**
   * Builds one metrics registration.
   *
   * @param options - The scrape path, registry, prefix, caps, and authorize hook.
   * @returns A frozen dynamic module an application imports.
   */
  static forRoot(options: MetricsModuleOptions = {}): DynamicModule {
    return registration([provideResolved(options)]);
  }

  /**
   * Builds a metrics registration whose options a factory resolves.
   *
   * @param options - The imports, injected tokens, factory, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: ModuleAsyncOptions<MetricsModuleOptions>): DynamicModule {
    return registration(
      moduleOptionsProviders(METRICS_OPTIONS_TOKEN, options, (resolved) =>
        Object.freeze({ ...resolved, registry: resolveRegistry(resolved) }),
      ),
      options.imports,
      options.extraProviders,
    );
  }

  /**
   * Builds one metrics registration.
   *
   * @deprecated Use {@link MetricsModule.forRoot}; retained for the beta line.
   */
  static register(options: MetricsModuleOptions = {}): DynamicModule {
    return MetricsModule.forRoot(options);
  }
}

function registration(
  optionsProviders: readonly Provider[],
  imports: readonly ModuleImport[] = [],
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  // A route path is fixed when the controller class is decorated, so a
  // registration whose value a factory resolves mounts at the default path. A
  // custom path belongs to `forRoot`, where the value exists at registration.
  const resolved = (optionsProviders[0] as { readonly useValue?: ResolvedMetricsOptions }).useValue;
  const path = normalizePath(resolved?.path ?? "/metrics");

  return dynamicModule({
    module: MetricsModule,
    id: `MetricsModule[${moduleKey}]`,
    instanceId: Symbol.for(`aponia.metrics:${moduleKey}`),
    imports,
    providers: [
      ...optionsProviders,
      provideFactory(
        MetricsRegistry,
        [METRICS_OPTIONS_TOKEN],
        (options: ResolvedMetricsOptions) => options.registry,
      ),
      provideClass(MetricsExceptionFilter, [MetricsRegistry]),
      provideRequestLifecycleHooksAsync(
        [METRICS_OPTIONS_TOKEN],
        (options) => createMetricsInstrumentation(options).hook,
      ),
      requirePlatformCapabilities("metrics", ["http"]),
      ...extraProviders,
    ],
    controllers: [createMetricsController(path)],
    exports: [MetricsRegistry, MetricsExceptionFilter],
  });
}

function provideResolved(options: MetricsModuleOptions): Provider {
  return provideValue(
    METRICS_OPTIONS_TOKEN,
    Object.freeze({ ...options, registry: resolveRegistry(options) }),
  );
}

function resolveRegistry(options: MetricsModuleOptions): MetricsRegistry {
  return (
    options.registry ??
    new MetricsRegistry({
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(options.maxSeriesPerMetric === undefined
        ? {}
        : { maxSeriesPerMetric: options.maxSeriesPerMetric }),
      ...(options.buckets === undefined ? {} : { buckets: options.buckets }),
    })
  );
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}
