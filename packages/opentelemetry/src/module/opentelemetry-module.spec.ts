import { afterAll, expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  UseGuards,
  defineConfiguration,
  type AponiaErrorCode,
  type CanActivate,
} from "@aponiajs/common";
import { AponiaFactory, httpErrors } from "@aponiajs/platform-elysia";
import { context, trace } from "@opentelemetry/api";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { OpentelemetryModule, type OpentelemetryConfiguration } from "../index.ts";
import { OpentelemetryShutdown } from "../tracing/opentelemetry-shutdown.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

function currentSpan(): ReturnType<typeof trace.getSpan> {
  return trace.getSpan(context.active());
}

import { exporter, processor } from "../../test/support/tracer.ts";

const OpentelemetryConfig = defineConfiguration(
  z
    .object({
      OTEL_SERVICE_NAME: z.string().min(1),
      OTEL_RECORD_BODY: z.enum(["true", "false"]).default("false"),
      OTEL_HEADER_NAMES: z.string().default(""),
    })
    .transform(({ OTEL_SERVICE_NAME, OTEL_RECORD_BODY, OTEL_HEADER_NAMES }) => ({
      serviceName: OTEL_SERVICE_NAME,
      recordBody: OTEL_RECORD_BODY === "true",
      headersToSpanAttributes: {
        request: OTEL_HEADER_NAMES.split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      },
    })),
  "opentelemetry.test.main",
);

const observed: string[] = [];

function spanPresence(stage: string): void {
  observed.push(`${stage}:${currentSpan()?.spanContext().spanId ? "yes" : "no"}`);
}

@Injectable()
class ReportingService {
  read(): string {
    spanPresence("service");
    return "service-value";
  }
}

@Injectable()
class AllowingGuard implements CanActivate {
  canActivate(): boolean {
    spanPresence("guard");
    return true;
  }
}

@Injectable()
class RefusingGuard implements CanActivate {
  canActivate(): boolean {
    spanPresence("refusing-guard");
    throw httpErrors.forbidden("A guard refused this request.");
  }
}

@Controller("probe")
class ProbeController {
  constructor(private readonly service: ReportingService) {}

  @Get("/ok")
  @UseGuards(AllowingGuard)
  ok(): string {
    spanPresence("handler");
    return this.service.read();
  }

  @Get("/refused")
  @UseGuards(RefusingGuard)
  refused(): string {
    return this.service.read();
  }

  @Get("/boom")
  boom(): never {
    spanPresence("failing-handler");
    throw new Error("a handler failed on purpose");
  }
}

@Module({
  imports: [
    OpentelemetryModule.register({
      configuration: OpentelemetryConfig,
      source: { OTEL_SERVICE_NAME: "aponia-first", OTEL_HEADER_NAMES: "x-trace" },
      spanProcessors: [processor],
    }),
  ],
  controllers: [ProbeController],
  providers: [ReportingService, AllowingGuard, RefusingGuard],
})
class AppModule {}

const application = await AponiaFactory.create(AppModule, { logger: false });

async function spansFor(
  request: Request,
): Promise<{ response: Response; spans: ReturnType<InMemorySpanExporter["getFinishedSpans"]> }> {
  const before = exporter.getFinishedSpans().length;
  const response = await application.handle(request);
  await processor.forceFlush();
  return { response, spans: exporter.getFinishedSpans().slice(before) };
}

test("records one server span active for the handler, a guard, and an injected service", async () => {
  observed.length = 0;
  const { response, spans } = await spansFor(
    new Request("http://localhost/probe/ok", { headers: { "x-trace": "trace-1" } }),
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("service-value");
  expect(observed).toEqual(["guard:yes", "handler:yes", "service:yes"]);

  const root = spans.find((span) => span.name === "GET /probe/ok");
  expect(root).toBeDefined();
  expect(root?.resource.attributes["service.name"]).toBe("aponia-first");
  expect(root?.attributes["http.request.method"]).toBe("GET");
  expect(root?.attributes["http.response.status_code"]).toBe(200);
  expect(root?.attributes["http.route"]).toBe("/probe/ok");
  expect(root?.attributes["http.request.header.x-trace"]).toBe("trace-1");
});

test("leaves a guard's refusal unset and answers Problem Details", async () => {
  observed.length = 0;
  const { response, spans } = await spansFor(new Request("http://localhost/probe/refused"));

  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(observed).toEqual(["refusing-guard:yes"]);

  const root = spans.find((span) => span.name === "GET /probe/refused");
  expect(root?.status.code).toBe(0);
});

test("marks the span failed when a handler throws, and answers 500", async () => {
  const { response, spans } = await spansFor(new Request("http://localhost/probe/boom"));

  expect(response.status).toBe(500);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ status: 500, code: "INTERNAL_SERVER_ERROR" });
  expect(JSON.stringify(body)).not.toContain("a handler failed on purpose");

  // The platform answers a thrown handler with a problem document rather than
  // rethrowing, so the hook reads the failure from the answer's status.
  const root = spans.find((span) => span.name === "GET /probe/boom");
  expect(root?.status.code).toBe(2);
  expect(root?.attributes["http.response.status_code"]).toBe(500);
});

test("records bodies and redacts credentials when the configuration asks", async () => {
  const RedactingConfig = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-redacted",
          recordBody: { request: true, response: true },
          headersToSpanAttributes: { response: ["content-type"] },
          spanUrlRedaction: { stripCredentials: true, sensitiveQueryParams: ["token"] },
        }) satisfies OpentelemetryConfiguration,
    ),
    "opentelemetry.test.redacted",
  );

  @Controller("redact")
  class RedactController {
    @Get("/")
    read(): string {
      return "redacted-body";
    }
  }

  @Module({
    imports: [OpentelemetryModule.register({ configuration: RedactingConfig, source: {} })],
    controllers: [RedactController],
  })
  class RedactModule {}

  const redacted = await AponiaFactory.create(RedactModule, { logger: false });
  try {
    const before = exporter.getFinishedSpans().length;
    const response = await redacted.handle(
      new Request("http://user:secret@localhost/redact?token=abc&keep=1"),
    );
    await processor.forceFlush();
    expect(response.status).toBe(200);

    const root = exporter
      .getFinishedSpans()
      .slice(before)
      .find((span) => span.name === "GET /redact");
    expect(root?.attributes["url.full"]).not.toContain("secret");
    expect(root?.attributes["url.full"]).not.toContain("abc");
    expect(root?.attributes["http.request.body"]).toBe("");
    expect(root?.attributes["http.response.body"]).toBe("redacted-body");
  } finally {
    await redacted.close();
  }
});

test("captures a configured response header on the span", async () => {
  const HeaderConfig = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-headers",
          headersToSpanAttributes: { response: ["x-echo"] },
        }) satisfies OpentelemetryConfiguration,
    ),
    "opentelemetry.test.headers",
  );

  @Controller("echo")
  class EchoController {
    @Get("/")
    @Header("x-echo", "echoed")
    read(): string {
      return "echoed-body";
    }
  }

  @Module({
    imports: [OpentelemetryModule.register({ configuration: HeaderConfig, source: {} })],
    controllers: [EchoController],
  })
  class HeaderModule {}

  const echo = await AponiaFactory.create(HeaderModule, { logger: false });
  try {
    const before = exporter.getFinishedSpans().length;
    const response = await echo.handle(new Request("http://localhost/echo"));
    await processor.forceFlush();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-echo")).toBe("echoed");

    const root = exporter
      .getFinishedSpans()
      .slice(before)
      .find((span) => span.name === "GET /echo");
    expect(root?.attributes["http.response.header.x-echo"]).toBe("echoed");
  } finally {
    await echo.close();
  }
});

test("leaves the URL as it arrived when redaction is switched off", async () => {
  const UnredactedConfig = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-unredacted",
          spanUrlRedaction: false,
        }) satisfies OpentelemetryConfiguration,
    ),
    "opentelemetry.test.unredacted",
  );

  @Controller("open")
  class OpenController {
    @Get("/")
    read(): string {
      return "open";
    }
  }

  @Module({
    imports: [OpentelemetryModule.register({ configuration: UnredactedConfig, source: {} })],
    controllers: [OpenController],
  })
  class OpenModule {}

  const open = await AponiaFactory.create(OpenModule, { logger: false });
  try {
    const before = exporter.getFinishedSpans().length;
    expect((await open.handle(new Request("http://localhost/open?token=abc"))).status).toBe(200);
    await processor.forceFlush();

    const root = exporter
      .getFinishedSpans()
      .slice(before)
      .find((span) => span.name === "GET /open");
    expect(root?.attributes["url.full"]).toBe("http://localhost/open?token=abc");
  } finally {
    await open.close();
  }
});

test("refuses a configuration the schema rejects", async () => {
  const Required = defineConfiguration(
    z.object({ OTEL_SERVICE_NAME: z.string().min(1) }).transform(({ OTEL_SERVICE_NAME }) => ({
      serviceName: OTEL_SERVICE_NAME,
    })),
    "opentelemetry.test.required",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Required, source: {} })] })
  class RequiredModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(RequiredModule, { logger: false });
  } catch (error) {
    failure = error;
  }
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
});

test("refuses a value whose fields are wrong, naming every one of them", async () => {
  const Broken = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "",
          recordBody: "yes",
          spanUrlRedaction: { stripCredentials: "no" },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.broken",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Broken, source: {} })] })
  class BrokenModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(BrokenModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.broken",
      issues: [
        '"serviceName" must be a non-empty string',
        '"recordBody" must be a boolean or an object of booleans when it is present',
        '"spanUrlRedaction" must be false or an object of redaction settings when it is present',
      ],
    },
  });
});

test("refuses a request body recorded beside a wildcard header capture", async () => {
  const Leaky = defineConfiguration(
    z.object({}).transform(
      () =>
        ({
          serviceName: "aponia-leaky",
          recordBody: { request: true },
          headersToSpanAttributes: { request: ["*"] },
        }) as unknown as OpentelemetryConfiguration,
    ),
    "opentelemetry.test.leaky",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: Leaky, source: {} })] })
  class LeakyModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(LeakyModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: "INVALID_CONFIGURATION_VALUE",
    details: {
      configuration: "opentelemetry.test.leaky",
      issues: [
        '"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "*": both are recorded on the exported span',
      ],
    },
  });
});

test("refuses a value that states no configuration at all", async () => {
  const None = defineConfiguration(
    z.object({}).transform(() => null as unknown as OpentelemetryConfiguration),
    "opentelemetry.test.none",
  );

  @Module({ imports: [OpentelemetryModule.register({ configuration: None, source: {} })] })
  class NoneModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(NoneModule, { logger: false });
  } catch (error) {
    failure = error;
  }
  expect(codeOf(failure)).toBe("INVALID_CONFIGURATION_VALUE");
});

test("shuts the declared processors down once", async () => {
  let flushes = 0;
  let shuts = 0;
  const fake = {
    forceFlush: () => {
      flushes += 1;
    },
    shutdown: () => {
      shuts += 1;
    },
  };

  const shutdown = new OpentelemetryShutdown([fake]);
  await shutdown.onApplicationShutdown();
  await shutdown.onApplicationShutdown();

  expect(flushes).toBe(1);
  expect(shuts).toBe(1);
});

afterAll(async () => {
  await application.close();
});
