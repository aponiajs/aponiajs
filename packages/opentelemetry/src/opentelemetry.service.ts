import { Injectable } from "@aponiajs/common";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type SpanOptions,
  type TextMapGetter,
  type TextMapSetter,
  type Tracer,
} from "@opentelemetry/api";
import type {
  ResolvedOpenTelemetryOptions,
  SpanAttributes,
} from "./interfaces/opentelemetry.interface.ts";

const headersGetter: TextMapGetter<Headers> = {
  keys(carrier: Headers): string[] {
    const keys: string[] = [];
    carrier.forEach((_, key) => {
      keys.push(key);
    });
    return keys;
  },
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined;
  },
};

const recordSetter: TextMapSetter<Record<string, string>> = {
  set(carrier: Record<string, string>, key: string, value: string): void {
    carrier[key] = value;
  },
};

/**
 * OpenTelemetry tracing and W3C context propagation service.
 */
@Injectable()
export class OpenTelemetryService {
  readonly #options: ResolvedOpenTelemetryOptions;

  constructor(options: ResolvedOpenTelemetryOptions) {
    this.#options = options;
  }

  /** Returns the configured tracer (or the global OpenTelemetry tracer). */
  getTracer(): Tracer {
    return (
      this.#options.tracer ??
      trace.getTracer(this.#options.serviceName, this.#options.serviceVersion)
    );
  }

  /** Returns the currently active span, if any. */
  currentSpan(): Span | undefined {
    return trace.getSpan(context.active());
  }

  /** Extracts an OpenTelemetry context from incoming HTTP request headers. */
  extractContext(headers: Headers, baseContext: Context = context.active()): Context {
    return propagation.extract(baseContext, headers, headersGetter);
  }

  /** Injects the active (or provided) trace context into an outbound header map. */
  injectHeaders(
    headers: Record<string, string> = {},
    targetContext: Context = context.active(),
  ): Record<string, string> {
    propagation.inject(targetContext, headers, recordSetter);
    return headers;
  }

  /** Runs an operation inside a newly started child span, recording errors and ending the span. */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options: SpanOptions & {
      readonly attributes?: SpanAttributes;
      readonly parentContext?: Context;
    } = {},
  ): Promise<T> {
    const tracer = this.getTracer();
    const parent = options.parentContext ?? context.active();
    const spanOptions: SpanOptions = {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: options.attributes,
      links: options.links,
      startTime: options.startTime,
      root: options.root,
    };
    const span = tracer.startSpan(name, spanOptions, parent);
    const spanContext = trace.setSpan(parent, span);

    return await context.with(spanContext, async () => {
      try {
        const result = await fn(span);
        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
