import type { OnApplicationShutdown } from "@aponiajs/common";

/**
 * The part of a span processor this provider drives: the two methods the
 * `SpanProcessor` interface declares for teardown.
 *
 * A structural type rather than the real `SpanProcessor`, for the reason cron's
 * `CronHandle` is: this package must not gain a runtime or type dependency on
 * `@opentelemetry/sdk-trace-base` to name something it only forwards a call to.
 * A real `SpanProcessor` satisfies this shape, so nothing is widened at the call
 * site.
 */
interface SpanProcessorHandle {
  forceFlush?(): void | Promise<void>;
  shutdown(): void | Promise<void>;
}

/**
 * Owns the span processors an application declared, and stops them when the
 * application closes.
 *
 * The wrapped plugin starts a `NodeSDK` while it mounts and keeps it to itself:
 * the SDK is a closure inside the plugin, no provider holds it, and
 * `application.close()` therefore reaches none of it. What this package can
 * still stop is the state the application handed it — the span processors in
 * `OpentelemetryModuleOptions.spanProcessors` — and this provider is where that
 * happens, so the teardown runs from the module graph rather than from the
 * plugin. A processor the application built some other way, and an exporter
 * `NodeSDK` constructed from its own options, are outside this provider's reach;
 * the README states that limit rather than implying a full teardown.
 *
 * The stop is idempotent: the processors are dropped once they are shut down, so
 * a second `close()` stops nothing a second time and cannot shut down a
 * processor another registration's SDK is still feeding.
 *
 * @internal
 */
export class OpentelemetryShutdown implements OnApplicationShutdown {
  #processors: readonly SpanProcessorHandle[];

  constructor(spanProcessors: readonly SpanProcessorHandle[]) {
    this.#processors = Object.freeze([...spanProcessors]);
  }

  async onApplicationShutdown(): Promise<void> {
    const processors = this.#processors;
    this.#processors = Object.freeze([]);

    for (const processor of processors) {
      await processor.shutdown();
    }
  }
}
