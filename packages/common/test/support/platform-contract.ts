import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Post,
  UseFilters,
  UseGuards,
  UseInterceptors,
  Version,
  type AponiaMiddleware,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type Interceptor,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import type { AponiaHttpApplicationOptions } from "../../src/index.ts";
import type { AponiaRootModule } from "../../src/index.ts";
import type { RouteValidatorInput } from "@aponiajs/common";

/** The application surface a platform must expose for the contract to run. */
export interface ConformanceApplication {
  /** Answers one request through the platform's own router. */
  handle(request: Request): Response | Promise<Response>;
  /** Answers a request the platform owns, or declines it. */
  tryHandle?(request: Request): Response | Promise<Response | undefined>;
  /** Releases the application. */
  close(): Promise<void>;
}

/** What a platform must expose for the shared contract to run. */
export interface ConformanceDriver extends ConformanceApplication {
  /** The platform name, used in failure messages. */
  readonly name: string;
}

/** Boots one fresh application for one case. */
export type ConformanceCreate = (
  options?: AponiaHttpApplicationOptions,
) => Promise<ConformanceDriver>;

/** One case every platform must pass. */
export interface ConformanceCase {
  /** The behavioral statement the case proves. */
  readonly name: string;
  /** Runs the case against a fresh application. */
  run(create: ConformanceCreate): Promise<void>;
}

/** What the middleware and interceptor cases record, in order. */
export const conformanceEvents: string[] = [];

/** Refuses every request it guards. */
@Injectable()
class RefusingGuard implements CanActivate {
  canActivate(): boolean {
    conformanceEvents.push("guard");
    return false;
  }
}

/** Answers with a fixed 599 so the case can tell the filter from the default. */
@Injectable()
class AnsweringFilter implements ExceptionFilter {
  catch(): Response {
    return new Response("caught", { status: 599 });
  }
}

/** Records its before half. */
@Injectable()
class FirstInterceptor implements Interceptor {
  interceptBefore(): void {
    conformanceEvents.push("first:before");
  }

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    conformanceEvents.push("first:after");
    return response;
  }
}

/** Records its before half; proves the after halves run in reverse. */
@Injectable()
class SecondInterceptor implements Interceptor {
  interceptBefore(): void {
    conformanceEvents.push("second:before");
  }

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    conformanceEvents.push("second:after");
    return response;
  }
}

/** Records that module middleware ran before the route's guard. */
@Injectable()
class RecordingMiddleware implements AponiaMiddleware {
  use(_context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    conformanceEvents.push("middleware");
    return next();
  }
}

const itemBody = {
  "~standard": {
    version: 1,
    vendor: "aponia-conformance",
    validate(value: unknown) {
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { readonly name?: unknown }).name === "string"
      ) {
        return { value };
      }
      return { issues: [{ message: "name must be a string" }] };
    },
  },
} as unknown as RouteValidatorInput;

/** The routes every platform must answer the same way. */
@Controller("conformance")
class ConformanceController {
  @Get()
  plain(): string {
    return "ok";
  }

  @Post("/", { body: itemBody })
  create(@Body() body: unknown): unknown {
    return body;
  }

  @Get("guarded")
  @UseGuards(RefusingGuard)
  guarded(): string {
    return "reached";
  }

  @Get("intercepted")
  @UseInterceptors(FirstInterceptor, SecondInterceptor)
  intercepted(): string {
    conformanceEvents.push("handler");
    return "intercepted";
  }

  @Get("boom")
  @UseFilters(AnsweringFilter)
  boom(): never {
    throw new Error("boom");
  }

  @Get("created")
  @Header("x-conformance", "yes")
  @HttpCode(201)
  created(): { readonly created: true } {
    return { created: true };
  }

  @Get("status")
  status(@HttpStatus() set: (code: string, body?: unknown) => Response): Response {
    return set("Accepted", { accepted: true });
  }

  @Version("1")
  @Get("versioned")
  versioned(): string {
    return "v1";
  }
}

/** One module, so every case boots the same graph. */
@Module({
  controllers: [ConformanceController],
  providers: [
    RefusingGuard,
    AnsweringFilter,
    FirstInterceptor,
    SecondInterceptor,
    RecordingMiddleware,
  ],
})
class ConformanceModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RecordingMiddleware).forRoutes("/conformance/guarded");
  }
}

const cases: ConformanceCase[] = [
  {
    name: "answers a plain route with 200 and its body",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(new Request("http://localhost/conformance"));
        assertEqual(response.status, 200, "plain route status");
        assertEqual(await response.text(), "ok", "plain route body");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "answers 404 for a path it did not mount",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(new Request("http://localhost/conformance/missing"));
        assertEqual(response.status, 404, "unmatched route status");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "mounts routes under the declared prefix",
    async run(create) {
      const app = await create({ logger: false, prefix: "/api" });
      try {
        const response = await app.handle(new Request("http://localhost/api/conformance"));
        assertEqual(response.status, 200, "prefixed route status");
        assertEqual(await response.text(), "ok", "prefixed route body");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "refuses an invalid body with 422",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(
          new Request("http://localhost/conformance", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: 1 }),
          }),
        );
        assertEqual(response.status, 422, "invalid body status");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "answers a guard refusal with 403 problem details",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(new Request("http://localhost/conformance/guarded"));
        assertEqual(response.status, 403, "guard refusal status");
        assertIncludes(
          response.headers.get("content-type") ?? "",
          "application/problem+json",
          "guard refusal content type",
        );
        assertEqual(await response.text().then((text) => text.includes("reached")), false, "guard");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "runs interceptor after halves in reverse order",
    async run(create) {
      const app = await create({ logger: false });
      try {
        conformanceEvents.length = 0;
        const response = await app.handle(new Request("http://localhost/conformance/intercepted"));
        assertEqual(await response.text(), "intercepted", "interceptor route body");
        assertDeepEqual(
          conformanceEvents,
          ["first:before", "second:before", "handler", "second:after", "first:after"],
          "interceptor order",
        );
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "answers a failure through the declared filter",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(new Request("http://localhost/conformance/boom"));
        assertEqual(response.status, 599, "filter status");
        assertEqual(await response.text(), "caught", "filter body");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "applies the declared header and status",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(new Request("http://localhost/conformance/created"));
        assertEqual(response.status, 201, "declared status");
        assertEqual(response.headers.get("x-conformance"), "yes", "declared header");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "answers through the status helper",
    async run(create) {
      const app = await create({ logger: false });
      try {
        const response = await app.handle(new Request("http://localhost/conformance/status"));
        assertEqual(response.status, 202, "status helper");
        assertDeepEqual(await response.json(), { accepted: true }, "status helper body");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "runs module middleware before a route's guard",
    async run(create) {
      const app = await create({ logger: false });
      try {
        conformanceEvents.length = 0;
        const response = await app.handle(new Request("http://localhost/conformance/guarded"));
        assertEqual(response.status, 403, "middleware case status");
        assertDeepEqual(conformanceEvents, ["middleware", "guard"], "middleware order");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "answers the health probes",
    async run(create) {
      const app = await create({ logger: false, health: true });
      try {
        const live = await app.handle(new Request("http://localhost/health/live"));
        assertEqual(live.status, 200, "liveness status");
        const ready = await app.handle(new Request("http://localhost/health/ready"));
        assertEqual(ready.status, 200, "readiness status");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "negotiates a version by header and refuses an unknown one",
    async run(create) {
      const app = await create({
        logger: false,
        versioning: { type: "header", defaultVersion: "1" },
      });
      try {
        const response = await app.handle(
          new Request("http://localhost/conformance/versioned", {
            headers: { "x-api-version": "1" },
          }),
        );
        assertEqual(response.status, 200, "versioned status");
        assertEqual(await response.text(), "v1", "versioned body");

        const unknown = await app.handle(
          new Request("http://localhost/conformance/versioned", {
            headers: { "x-api-version": "9" },
          }),
        );
        assertEqual(unknown.status, 400, "unknown version status");
        const problem = (await unknown.json()) as { readonly code?: unknown };
        assertEqual(problem.code, "API_VERSION_NOT_FOUND", "unknown version code");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "applies the declared security headers",
    async run(create) {
      const app = await create({ logger: false, securityHeaders: true });
      try {
        const response = await app.handle(new Request("http://localhost/conformance"));
        assertEqual(response.headers.get("x-content-type-options"), "nosniff", "security header");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "answers a CORS preflight for an allowed origin",
    async run(create) {
      const app = await create({ logger: false, cors: { origin: "https://app.test" } });
      try {
        const response = await app.handle(
          new Request("http://localhost/conformance", {
            method: "OPTIONS",
            headers: {
              origin: "https://app.test",
              "access-control-request-method": "GET",
            },
          }),
        );
        assertEqual(response.status, 204, "preflight status");
        assertEqual(
          response.headers.get("access-control-allow-origin"),
          "https://app.test",
          "preflight origin",
        );
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "emits an ETag and answers a matching if-none-match with 304",
    async run(create) {
      const app = await create({ logger: false, etag: true });
      try {
        const first = await app.handle(new Request("http://localhost/conformance"));
        const tag = first.headers.get("etag");
        if (tag === null) {
          throw new Error("etag: expected a tag on the first answer");
        }
        const second = await app.handle(
          new Request("http://localhost/conformance", {
            headers: { "if-none-match": tag },
          }),
        );
        assertEqual(second.status, 304, "etag revalidation status");
      } finally {
        await app.close?.();
      }
    },
  },
  {
    name: "declines an unmatched request through tryHandle",
    async run(create) {
      const app = await create({ logger: false });
      try {
        if (app.tryHandle === undefined) {
          return;
        }
        assertEqual(
          await app.tryHandle(new Request("http://localhost/conformance/missing")),
          undefined,
          "tryHandle decline",
        );
        const matched = await app.tryHandle(new Request("http://localhost/conformance"));
        assertEqual(matched?.status, 200, "tryHandle match");
      } finally {
        await app.close?.();
      }
    },
  },
];

/** Every case, in the order a platform should report them. */
export const platformConformanceCases: readonly ConformanceCase[] = Object.freeze(cases);

/** Boots the shared fixture module on one platform. */
export type ConformanceBoot = (
  rootModule: AponiaRootModule,
  options?: AponiaHttpApplicationOptions,
) => Promise<ConformanceApplication>;

/**
 * Builds the `create` a case receives from a platform's own factory.
 *
 * @param boot - The platform's `AponiaFactory.create`.
 * @returns The factory the cases call.
 */
export function conformanceCreate(boot: ConformanceBoot): ConformanceCreate {
  return async (options) => {
    const application = await boot(ConformanceModule, options);
    return {
      name: "platform",
      handle: async (request) => await application.handle(request),
      ...(application.tryHandle === undefined
        ? {}
        : {
            tryHandle: async (request: Request) => await application.tryHandle?.(request),
          }),
      close: async () => {
        await application.close();
      },
    };
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${label}: expected ${right}, received ${left}`);
  }
}

function assertIncludes(actual: string, expected: string, label: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${label}: expected to include "${expected}", received "${actual}"`);
  }
}
