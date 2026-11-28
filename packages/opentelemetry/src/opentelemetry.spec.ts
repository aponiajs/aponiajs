import { describe, expect, it } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanContext,
  type SpanOptions,
  type TextMapPropagator,
  type Tracer,
} from "@opentelemetry/api";
import { OpenTelemetryModule, OpenTelemetryService } from "./index.ts";

interface RecordedSpan {
  readonly name: string;
  readonly options: SpanOptions;
  readonly attributes: Record<string, unknown>;
  status?: { code: number; message?: string };
  ended: boolean;
  exceptions: unknown[];
}

function createFakeTracer(): { tracer: Tracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer: Tracer = {
    startSpan(name: string, options: SpanOptions = {}): Span {
      const recorded: RecordedSpan = {
        name,
        options,
        attributes: { ...options.attributes },
        ended: false,
        exceptions: [],
      };
      spans.push(recorded);
      const fakeSpanContext: SpanContext = {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: 1,
      };
      const span: Span = {
        spanContext: () => fakeSpanContext,
        setAttribute(key, value) {
          recorded.attributes[key] = value;
          return span;
        },
        setAttributes(attributes) {
          Object.assign(recorded.attributes, attributes);
          return span;
        },
        addEvent: () => span,
        addLink: () => span,
        addLinks: () => span,
        setStatus(status) {
          recorded.status = status;
          return span;
        },
        updateName: () => span,
        end() {
          recorded.ended = true;
        },
        isRecording: () => !recorded.ended,
        recordException(exception) {
          recorded.exceptions.push(exception);
        },
      };
      return span;
    },
    startActiveSpan: (() => {
      throw new Error("not used");
    }) as Tracer["startActiveSpan"],
  };
  return { tracer, spans };
}

describe("OpenTelemetryModule & OpenTelemetryService", () => {
  it("creates HTTP server spans, skips ignored paths, and propagates context", async () => {
    const { tracer, spans } = createFakeTracer();

    @Controller("orders")
    class OrdersController {
      @Get()
      list(): { readonly ok: boolean } {
        return { ok: true };
      }

      @Get("fail")
      fail(): never {
        throw new Error("boom");
      }
    }

    @Module({
      imports: [
        OpenTelemetryModule.forRoot({
          serviceName: "orders-api",
          ignorePaths: ["/metrics"],
          tracer,
        }),
      ],
      controllers: [OrdersController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const okRes = await app.handle(new Request("http://localhost/orders"));
      expect(okRes.status).toBe(200);
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe("HTTP GET /orders");
      expect(spans[0]!.options.kind).toBe(SpanKind.SERVER);
      expect(spans[0]!.attributes["http.response.status_code"]).toBe(200);
      expect(spans[0]!.ended).toBe(true);

      await app.handle(new Request("http://localhost/metrics"));
      expect(spans).toHaveLength(1);

      const errRes = await app.handle(new Request("http://localhost/orders/fail"));
      expect(errRes.status).toBe(500);
      expect(spans).toHaveLength(2);
      expect(spans[1]!.status?.code).toBe(SpanStatusCode.ERROR);

      const otel = app.get(OpenTelemetryService);
      await expect(
        otel.withSpan("db.query", () => {
          throw new Error("query failed");
        }),
      ).rejects.toThrow("query failed");
      expect(spans[2]!.exceptions).toHaveLength(1);
      expect(spans[2]!.ended).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("supports forRootAsync, injectHeaders, and rejects blank serviceName", async () => {
    expect(() => OpenTelemetryModule.forRoot({ serviceName: "   " })).toThrow();

    @Controller("trace")
    class TraceController {
      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({
      imports: [
        OpenTelemetryModule.forRootAsync({
          useFactory: async () => ({
            serviceName: "async-api",
            traceHttp: false,
          }),
        }),
      ],
      controllers: [TraceController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const res = await app.handle(new Request("http://localhost/trace"));
      expect(res.status).toBe(200);
      const otel = app.get(OpenTelemetryService);
      expect(otel.currentSpan()).toBeUndefined();
      expect(otel.injectHeaders({})).toEqual({});

      const customProp: TextMapPropagator = {
        inject(_ctx, carrier, setter) {
          setter.set(carrier, "traceparent", "00-1234-5678-01");
        },
        extract(ctx, carrier, getter) {
          expect(getter.keys(carrier)).toContain("x-trace");
          expect(getter.get(carrier, "x-trace")).toBe("1");
          return ctx;
        },
        fields: () => ["traceparent"],
      };
      propagation.setGlobalPropagator(customProp);
      try {
        const headers = new Headers({ "x-trace": "1" });
        expect(otel.extractContext(headers, context.active())).toBeDefined();
        expect(otel.injectHeaders({})).toEqual({ traceparent: "00-1234-5678-01" });
      } finally {
        propagation.disable();
      }
      expect(otel.getTracer()).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
