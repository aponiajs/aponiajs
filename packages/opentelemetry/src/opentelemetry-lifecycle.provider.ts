import type { RequestLifecycleHook } from "@aponiajs/common";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { ResolvedOpenTelemetryOptions } from "./interfaces/opentelemetry.interface.ts";
import type { OpenTelemetryService } from "./opentelemetry.service.ts";

/**
 * Creates the opt-in `RequestLifecycleHook` that extracts incoming W3C trace
 * context and wraps each HTTP request in a server span.
 */
export function createOpenTelemetryLifecycleHook(
  options: ResolvedOpenTelemetryOptions,
  otel: OpenTelemetryService,
): RequestLifecycleHook {
  return {
    name: "opentelemetry",
    async wrap(request: Request, next: (request: Request) => Promise<Response>): Promise<Response> {
      if (!options.traceHttp) {
        return await next(request);
      }
      const pathname = extractPathname(request.url);
      if (options.ignorePaths.some((prefix) => pathname.startsWith(prefix))) {
        return await next(request);
      }

      const parentContext = otel.extractContext(request.headers);
      const method = request.method.toUpperCase();
      return await otel.withSpan(
        `HTTP ${method} ${pathname}`,
        async (span) => {
          const response = await next(request);
          span.setAttribute("http.response.status_code", response.status);
          if (response.status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          return response;
        },
        {
          kind: SpanKind.SERVER,
          parentContext,
          attributes: {
            "http.request.method": method,
            "url.path": pathname,
          },
        },
      );
    },
  };
}

function extractPathname(url: string): string {
  const schemeIndex = url.indexOf("://");
  const pathStart = schemeIndex === -1 ? 0 : url.indexOf("/", schemeIndex + 3);
  if (pathStart === -1) {
    return "/";
  }
  const queryIndex = url.indexOf("?", pathStart);
  return queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex);
}
