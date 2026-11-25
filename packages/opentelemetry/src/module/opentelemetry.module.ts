import { Module, dynamicModule, provideValue, type DynamicModule } from "@aponiajs/common";
import {
  provideConfiguration,
  provideRequestLifecycleHooksAsync,
  requirePlatformCapabilities,
} from "@aponiajs/platform-core";
import { OpentelemetryShutdown } from "../tracing/opentelemetry-shutdown.ts";
import {
  createOpentelemetryHook,
  readOpentelemetryPolicy,
  type OpentelemetryRuntimeOptions,
} from "../tracing/opentelemetry.policy.ts";
import type { OpentelemetryModuleOptions } from "../interfaces/opentelemetry-module.interface.ts";

const defaultKey = "opentelemetry";

/**
 * The module an application imports to trace its routes with OpenTelemetry.
 *
 * ```ts
 * const tracing = OpentelemetryModule.register({ configuration: OpentelemetryConfig });
 *
 * @Module({ imports: [tracing] })
 * export class AppModule {}
 * ```
 *
 * Tracing is a neutral `RequestLifecycleHook`: the server span is active for
 * the handler, the guards, and every service it calls, on every platform.
 *
 * **One registration per process is the supported shape.** The SDK a
 * registration starts is process-global, and the first registration owns it;
 * see `createOpentelemetryHook` for what a second one does and does not get.
 */
@Module({})
export class OpentelemetryModule {
  /**
   * Builds the OpenTelemetry module for one application.
   *
   * @param options - The configuration, runtime processors and instrumentations,
   * literal source, and module key.
   * @returns A frozen registration the application's `imports` accepts.
   */
  static forRoot(options: OpentelemetryModuleOptions): DynamicModule {
    const { configuration, source, key, sdk, ...runtime } = options;
    const runtimeOptions: Readonly<OpentelemetryRuntimeOptions> = Object.freeze({ ...runtime });

    return dynamicModule({
      module: OpentelemetryModule,
      id: `OpentelemetryModule[${key ?? defaultKey}]`,
      instanceId: Symbol.for(`aponia.opentelemetry:${key ?? defaultKey}`),
      providers: [
        provideConfiguration(configuration, source === undefined ? undefined : { source }),
        provideRequestLifecycleHooksAsync([configuration], (value) =>
          createOpentelemetryHook(runtimeOptions, readOpentelemetryPolicy(value, configuration)),
        ),
        // The one per-boot state this package owns: the processors the
        // application declared, stopped by a provider hook.
        provideValue(
          OpentelemetryShutdown,
          new OpentelemetryShutdown(runtimeOptions.spanProcessors ?? [], sdk),
        ),
        requirePlatformCapabilities("opentelemetry", ["http"]),
      ],
      exports: [configuration],
    });
  }

  /**
   * Builds the tracing module for one application.
   *
   * @deprecated Use {@link OpentelemetryModule.forRoot}; retained for the beta line.
   */
  static register(options: OpentelemetryModuleOptions): DynamicModule {
    return OpentelemetryModule.forRoot(options);
  }
}
