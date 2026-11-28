import {
  AponiaError,
  Module,
  provideFactory,
  provideRequestLifecycleHooksAsync,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import type {
  OpenTelemetryModuleOptions,
  ResolvedOpenTelemetryOptions,
} from "./interfaces/opentelemetry.interface.ts";
import { createOpenTelemetryLifecycleHook } from "./opentelemetry-lifecycle.provider.ts";
import { OPENTELEMETRY_OPTIONS } from "./opentelemetry.constants.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type OpenTelemetryModuleRegistrationAsyncOptions,
  type OpenTelemetryModuleSyncOptions,
} from "./opentelemetry.module-definition.ts";
import { OpenTelemetryService } from "./opentelemetry.service.ts";

/**
 * Registers opt-in OpenTelemetry tracing and W3C context propagation.
 */
@Module({})
export class OpenTelemetryModule extends ConfigurableModuleClass {
  static forRoot(options: OpenTelemetryModuleSyncOptions = {}): DynamicModule {
    resolveOpenTelemetryOptions(options);
    return registration(super.register(options));
  }

  static forRootAsync(options: OpenTelemetryModuleRegistrationAsyncOptions): DynamicModule {
    return registration(super.registerAsync(options), options.extraProviders);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: OpenTelemetryModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(
        OPENTELEMETRY_OPTIONS,
        [MODULE_OPTIONS_TOKEN],
        (options: OpenTelemetryModuleOptions) => resolveOpenTelemetryOptions(options),
      ),
      provideFactory(
        OpenTelemetryService,
        [OPENTELEMETRY_OPTIONS],
        (options: ResolvedOpenTelemetryOptions) => new OpenTelemetryService(options),
      ),
      provideRequestLifecycleHooksAsync(
        [OPENTELEMETRY_OPTIONS, OpenTelemetryService],
        (options, otel) => createOpenTelemetryLifecycleHook(options, otel),
      ),
      ...extraProviders,
    ]),
    exports: Object.freeze([
      ...(definition.exports ?? []),
      MODULE_OPTIONS_TOKEN,
      OpenTelemetryService,
    ]),
  });
}

function resolveOpenTelemetryOptions(
  options: OpenTelemetryModuleOptions,
): ResolvedOpenTelemetryOptions {
  const serviceName = options.serviceName ?? "@aponiajs/opentelemetry";
  if (typeof serviceName !== "string" || serviceName.trim() === "") {
    throw new AponiaError(
      "INVALID_OPENTELEMETRY_OPTIONS",
      "serviceName must be a non-empty string.",
      { status: 500 },
    );
  }
  return Object.freeze({
    serviceName,
    serviceVersion: options.serviceVersion,
    traceHttp: options.traceHttp ?? true,
    ignorePaths: Object.freeze([...(options.ignorePaths ?? [])]),
    tracer: options.tracer,
  });
}
