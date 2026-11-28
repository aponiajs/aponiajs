import type { ConfigurableModuleAsyncOptions } from "@aponiajs/common";
import type { Attributes, Span, Tracer } from "@opentelemetry/api";

/** Span attribute map. */
export type SpanAttributes = Attributes;

/** Options accepted by `OpenTelemetryModule.forRoot`. */
export interface OpenTelemetryModuleOptions {
  /** Instrumentation scope name passed to `trace.getTracer`; defaults to `"@aponiajs/opentelemetry"`. */
  readonly serviceName?: string;
  /** Instrumentation scope version. */
  readonly serviceVersion?: string;
  /** Whether to trace incoming HTTP requests automatically; defaults to `true`. */
  readonly traceHttp?: boolean;
  /** Path prefixes excluded from automatic HTTP span creation (e.g. `["/metrics", "/health"]`). */
  readonly ignorePaths?: readonly string[];
  /** Optional custom tracer instance; defaults to `trace.getTracer(serviceName, serviceVersion)`. */
  readonly tracer?: Tracer;
}

/** Validated options resolved by `OpenTelemetryModule`. */
export interface ResolvedOpenTelemetryOptions {
  readonly serviceName: string;
  readonly serviceVersion: string | undefined;
  readonly traceHttp: boolean;
  readonly ignorePaths: readonly string[];
  readonly tracer: Tracer | undefined;
}

/** Asynchronous options accepted by `OpenTelemetryModule.forRootAsync`. */
export type OpenTelemetryModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<OpenTelemetryModuleOptions>;

/** Re-exported active span type for convenience. */
export type ActiveSpan = Span;
