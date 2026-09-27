import { describe, expect, spyOn, test } from "bun:test";
import {
  Body,
  Catch,
  Controller,
  Get,
  Injectable,
  MessageBody,
  Module,
  Post,
  Set,
  SubscribeMessage,
  UseFilters,
  UseGuards,
  WebSocketGateway,
  type ArgumentsHost,
  type CanActivate,
  type LoggerService,
  type RouteContext,
  type RouteResponseSettings,
} from "@aponiajs/common";
import { t, status } from "elysia";
import { AponiaFactory, httpErrors } from "../src/index.ts";

class NotFoundError extends Error {}

@Catch(NotFoundError)
@Injectable()
class NotFoundFilter {
  catch(): unknown {
    return new Response("handled by filter", { status: 404 });
  }
}

@Catch()
@Injectable()
class CatchAllFilter {
  catch(): unknown {
    return new Response("caught anything", { status: 503 });
  }
}

@Catch()
@Injectable()
class UndecidedFilter {
  catch(): unknown {
    return undefined;
  }
}

@Injectable()
class BrokenFilter {
  catch(): unknown {
    throw new Error("filter exploded");
  }
}

@Catch(NotFoundError)
@Injectable()
class AsyncAnsweringFilter {
  async catch(): Promise<unknown> {
    return new Response("handled asynchronously", { status: 404 });
  }
}

@Controller("mapped")
@UseFilters(NotFoundFilter)
class MappedController {
  @Get("missing")
  missing(): string {
    throw new NotFoundError("nope");
  }

  @Get("plain")
  plain(): string {
    throw new Error("unmapped");
  }
}

@Controller("all")
@UseFilters(CatchAllFilter)
class AllController {
  @Get()
  boom(): string {
    throw new Error("anything");
  }
}

@Controller("undecided")
@UseFilters(UndecidedFilter)
class UndecidedController {
  @Get()
  boom(): string {
    throw new Error("still unmapped");
  }
}

@Controller("broken")
@UseFilters(BrokenFilter)
class BrokenController {
  @Get()
  boom(): string {
    throw new Error("unmapped as well");
  }
}

@Controller("async")
@UseFilters(AsyncAnsweringFilter)
class AsyncController {
  @Get()
  boom(): string {
    throw new NotFoundError("nope");
  }
}

@Controller("http")
class HttpController {
  @Get()
  forbidden(): string {
    throw httpErrors.forbidden("no");
  }
}

@Injectable()
class RefusingGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

/** Declines by returning `null`, the other value Elysia's error path reads as no answer. */
@Catch()
@Injectable()
class NullFilter {
  catch(): unknown {
    return null;
  }
}

@Controller("refused")
@UseGuards(RefusingGuard)
@UseFilters(CatchAllFilter)
class RefusedController {
  @Get()
  read(): string {
    return "the guard never allowed this";
  }
}

@Controller("null-declined")
@UseGuards(RefusingGuard)
@UseFilters(NullFilter)
class NullDeclinedController {
  @Get()
  read(): string {
    return "the guard never allowed this";
  }
}

/** The exception the validation-answering filter was consulted with. */
const validationCatch: { exception?: unknown } = {};

@Catch(Error)
@Injectable()
class ValidationAnsweringFilter {
  catch(exception: unknown): unknown {
    validationCatch.exception = exception;
    return new Response("answered before the handler ran", { status: 400 });
  }
}

@Controller("validated-filtered")
@UseFilters(ValidationAnsweringFilter)
class ValidatedFilteredController {
  @Post("items", { body: t.Object({ name: t.String() }) })
  create(@Body() body: { name: string }): { name: string } {
    return { name: body.name };
  }
}

/**
 * What a filter is actually handed for a real request, recorded by the filter
 * itself — the same probe shape `tests/guards.test.ts` uses for the context a
 * guard receives, so a case asserts the arguments rather than executing them.
 */
interface FilterProbe {
  exception?: unknown;
  context?: RouteContext;
  request?: RouteContext;
}

const filterProbe: FilterProbe = {};

/** The exact value the probed handler throws, so its identity can be asserted. */
const probedFailure = new Error("the prober's own failure");

@Catch(Error)
@Injectable()
class ProbeFilter {
  catch(exception: unknown, host: ArgumentsHost): unknown {
    filterProbe.exception = exception;
    filterProbe.context = host.getContext();
    filterProbe.request = host.switchToHttp().getRequest();

    return undefined;
  }
}

@Controller("probe")
@UseFilters(ProbeFilter)
class ProbeController {
  @Get()
  read(): string {
    throw probedFailure;
  }
}

@Controller("validated")
class ValidatedController {
  @Post("items", { body: t.Object({ name: t.String() }) })
  create(@Body() body: { name: string }): { name: string } {
    return { name: body.name };
  }
}

/**
 * A transform whose decode refuses one value, so the route fails inside
 * Elysia's own transform-decode path rather than inside a handler: the thrown
 * value carries neither a status nor a `toResponse()`, and nothing but the
 * status Elysia decided for it says what the answer is.
 */
const whenModel = t
  .Transform(t.String())
  .Decode((value: string): string => {
    if (value === "unreadable") {
      throw new Error("The when value could not be decoded.");
    }
    return value;
  })
  .Encode((value) => value);

@Controller("transformed")
class TransformController {
  @Post("when", { body: t.Object({ when: whenModel }) })
  read(@Body() body: { when: string }): { when: string } {
    return { when: body.when };
  }

  @Get("decided")
  decided(@Set() set: RouteResponseSettings): string {
    set.status = 418;
    throw new Error("decided before the throw");
  }

  @Get("named")
  named(@Set() set: RouteResponseSettings): string {
    set.status = "I'm a Teapot";
    throw new Error("named before the throw");
  }

  @Get("early")
  early(@Set() set: RouteResponseSettings): string {
    set.status = 200;
    throw new Error("decided too early");
  }
}

class TeapotError extends Error {
  toResponse(): Response {
    return new Response("teapot body", { status: 418 });
  }
}

@Controller("native")
class NativeController {
  @Get("status")
  customStatus(): unknown {
    throw status(404, "gone the native way");
  }

  @Get("teapot")
  teapot(): string {
    throw new TeapotError("not a teapot");
  }

  @Get("string")
  thrownString(): string {
    // A thrown non-Error is legal JavaScript and has to answer something.
    throw "plain string";
  }
}

@Module({
  controllers: [
    MappedController,
    AllController,
    UndecidedController,
    BrokenController,
    AsyncController,
    HttpController,
    RefusedController,
    NullDeclinedController,
    ValidatedFilteredController,
    ProbeController,
    ValidatedController,
    NativeController,
    TransformController,
  ],
  providers: [
    NotFoundFilter,
    CatchAllFilter,
    UndecidedFilter,
    BrokenFilter,
    AsyncAnsweringFilter,
    RefusingGuard,
    NullFilter,
    ValidationAnsweringFilter,
    ProbeFilter,
  ],
})
class AppModule {}

@WebSocketGateway("/gateway-failure")
class FailingGateway {
  @SubscribeMessage("boom")
  boom(@MessageBody() data: unknown): unknown {
    throw new Error(`private gateway detail: ${JSON.stringify(data)}`);
  }
}

@Module({ providers: [FailingGateway] })
class FailingGatewayModule {}

/**
 * The system logger a boot is given when a case has to read what the platform
 * reported, since `logger: false` leaves nothing to read.
 */
class RecordingLogger implements LoggerService {
  readonly errors: { readonly context: string; readonly message: string }[] = [];
  readonly warnings: { readonly context: string; readonly message: string }[] = [];

  log(): void {}

  fatal(): void {}

  warn(message: unknown, context?: unknown): void {
    this.warnings.push(record(message, context));
  }

  error(message: unknown, context?: unknown): void {
    this.errors.push(record(message, context));
  }
}

function record(
  message: unknown,
  context: unknown,
): { readonly context: string; readonly message: string } {
  return { context: typeof context === "string" ? context : "", message: String(message) };
}

/**
 * A logger whose `error` refuses where an application would read the failure.
 *
 * Every other fixture in this file records the line it was handed, which is the
 * wrong shape for the guard: the failure under test is one the logger itself
 * produces, so it has to refuse rather than record.
 */
class RefusingLogger implements LoggerService {
  error(): void {
    throw new Error("the logger refused to report the failure");
  }

  log(): void {}

  fatal(): void {}

  warn(): void {}
}

describe("exception filters", () => {
  test("a filter receives the thrown value and the request's own host", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/probe"));
    const body = await response.text();

    // The exception is the value the handler threw, not a wrapper, and the host
    // carries the request's own context. A call site that passed the host where
    // the exception belongs, or a context in the exception's place, fails this
    // case and only this case.
    expect(filterProbe.exception).toBe(probedFailure);
    expect(filterProbe.context?.path).toBe("/probe");
    expect(filterProbe.context?.request.url).toBe("http://localhost/probe");
    expect(filterProbe.request).toBe(filterProbe.context);
    // The probe filter declined, so the mapping behind it still answered.
    expect(response.status).toBe(500);
    expect(body).not.toContain("the prober's own failure");
    await application.close();
  });

  test("a filter answers the type @Catch named", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/mapped/missing"));

    expect([response.status, await response.text()]).toEqual([404, "handled by filter"]);
    await application.close();
  });

  test("an unhandled error becomes Problem Details without leaking the stack", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/mapped/plain"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).not.toContain("unmapped");
    expect(body).not.toContain("at ");
    await application.close();
  });

  test("@Catch() with no arguments answers anything", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/all"));

    expect([response.status, await response.text()]).toEqual([503, "caught anything"]);
    await application.close();
  });

  test("a filter returning undefined does not consume the error", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/undecided"));

    expect(response.status).toBe(500);
    await application.close();
  });

  test("HttpError keeps its own Problem Details status", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/http"));

    expect(response.status).toBe(403);
    await application.close();
  });

  test("a declared filter answers a guard's refusal before the mapping does", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/refused"));

    // The refusal is the guard's thrown `HttpError`, and the route's own filter
    // runs before the mapping and matches it like any other exception: the
    // catch-all answers its `503`, not the `403` the mapping would leave.
    expect([response.status, await response.text()]).toEqual([503, "caught anything"]);
    await application.close();
  });

  test("a filter returning null declines, so the refusal answers instead", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/null-declined"));
    const body = await response.text();

    // `null` is the second value Elysia's error path reads as no answer: the
    // filter decided nothing, so the refusal reaches the mapping, which declines
    // the `HttpError` and leaves Elysia's own `403` Problem Details.
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toContain("A guard refused this request.");
    await application.close();
  });

  test("an asynchronous filter answers the same way a synchronous one does", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/async"));

    expect([response.status, await response.text()]).toEqual([404, "handled asynchronously"]);
    await application.close();
  });

  test("a filter that throws produces one clean 500 and reports the failure", async () => {
    const logger = new RecordingLogger();
    const application = await AponiaFactory.create(AppModule, { logger });

    const response = await application.handle(new Request("http://localhost/broken"));
    const body = await response.text();

    // The filter's own failure is reported rather than swallowed, and the
    // mapping behind it still answers: one response, not a second failure.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(logger.errors.map((record) => record.message)).toEqual([
      "Error: filter exploded",
      "Error: unmapped as well",
    ]);
    expect(body).not.toContain("filter exploded");
    expect(body).not.toContain("unmapped as well");
    await application.close();
  });

  test("a logger that throws while reporting leaves the mapping's 500 intact", async () => {
    const logger = new RefusingLogger();
    const application = await AponiaFactory.create(AppModule, { logger });
    const stderr: string[] = [];
    const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      const response = await application.handle(new Request("http://localhost/broken"));
      const body = await response.text();

      // One request, two guarded sites: the filter hook reports the filter's own
      // failure and declines, then the mapping reports the handler's failure and
      // answers. The count is the point — it fails if either site is left
      // unguarded, because an unguarded one would reject the route's `error`
      // hook and hand the client the engine's page instead of this answer.
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(body).not.toContain("the logger refused");
      expect(stderr).toHaveLength(2);
      for (const line of stderr) {
        expect(line).toContain("[ExceptionsHandler]");
        expect(line).toContain("the configured logger threw");
        expect(line).toContain("the logger refused to report the failure");
      }
    } finally {
      stderrWrite.mockRestore();
      await application.close();
    }
  });

  test("Elysia's own validation failure keeps its native response", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(
      new Request("http://localhost/validated/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 1 }),
      }),
    );

    // Elysia's framework errors are declined rather than mapped, so a request
    // rejected before a handler ran still answers with the native validation
    // body rather than a Problem Details 500.
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).not.toContain("problem+json");
    await application.close();
  });

  test("a declared filter is consulted for a validation 422 and can answer it", async () => {
    validationCatch.exception = undefined;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(
      new Request("http://localhost/validated-filtered/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 1 }),
      }),
    );

    // Declining Elysia's own errors is the default mapping's rule, not the
    // array's: a filter declared ahead of the mapping is consulted for every
    // exception its `@Catch()` matches, Elysia's validation refusal included,
    // and what it answers replaces the native 422.
    expect(validationCatch.exception).toBeInstanceOf(Error);
    expect([response.status, await response.text()]).toEqual([
      400,
      "answered before the handler ran",
    ]);
    await application.close();
  });
});

describe("what the default mapping declines", () => {
  test("the status() escape hatch keeps the response it was thrown with", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/native/status"));

    expect([response.status, await response.text()]).toEqual([404, "gone the native way"]);
    await application.close();
  });

  test("an exception carrying its own toResponse answers with it", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/native/teapot"));

    expect([response.status, await response.text()]).toEqual([418, "teapot body"]);
    await application.close();
  });

  test("a thrown non-Error becomes Problem Details rather than echoing itself", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/native/string"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).not.toContain("plain string");
    await application.close();
  });
});

describe("what Elysia's own error path already answers", () => {
  test("a transform decode failure keeps Elysia's 422 and the decode error's message", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(
      new Request("http://localhost/transformed/when", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ when: "unreadable" }),
      }),
    );
    const body = await response.text();

    // Nothing on the thrown value says what the answer is: the decode function
    // threw a plain Error, and Elysia had already decided the status when it
    // coerced the transform failure. The mapping must not replace a client
    // error with a 500.
    expect(response.status).toBe(422);
    expect(body).toContain("The when value could not be decoded.");
    await application.close();
  });

  test("a status a handler decided before throwing is the status the client sees", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/transformed/decided"));
    const body = await response.text();

    expect(response.status).toBe(418);
    expect(body).toContain("decided before the throw");
    await application.close();
  });

  test("a status name a handler decided is left as Elysia answers it", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/transformed/named"));
    const body = await response.text();

    // Elysia's own error path never overwrites a status it finds in the
    // context — that is the rule the mapping declines by — and it leaves a
    // status name alone rather than resolving it: on this version the client
    // sees the name dropped to 200 with the message Elysia's unknown-error
    // fallback renders. That is Elysia's answer for the request, unchanged by
    // the mapping; the mapping must not replace a status already decided with
    // a Problem Details 500.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").not.toContain("problem+json");
    expect(body).toContain("named before the throw");
    await application.close();
  });

  test("a status below 300 is not a decision, so the mapping still answers", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/transformed/early"));
    const body = await response.text();

    // Elysia seeds 500 over any status below 300 it finds, so a handler that
    // set one before throwing decided nothing: this is an unhandled failure,
    // and it answers like every other one.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).not.toContain("decided too early");
    await application.close();
  });

  test("a successful transform still answers the decoded value", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(
      new Request("http://localhost/transformed/when", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ when: "readable" }),
      }),
    );

    expect([response.status, await response.json()]).toEqual([200, { when: "readable" }]);
    await application.close();
  });
});

describe("the mapping with Elysia's AOT compilation disabled", () => {
  test("a boot with aot: false warns that the filters and the mapping never run", async () => {
    const logger = new RecordingLogger();
    const application = await AponiaFactory.create(AppModule, {
      logger,
      elysia: { aot: false },
    });

    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.context).toBe("RoutesResolver");
    expect(logger.warnings[0]?.message).toContain("aot: false");
    expect(logger.warnings[0]?.message).toContain("Problem Details mapping");
    await application.close();
  });

  test("a boot on the AOT path warns about nothing", async () => {
    const logger = new RecordingLogger();
    const application = await AponiaFactory.create(AppModule, { logger });

    expect(logger.warnings).toEqual([]);
    await application.close();
  });
});

describe("the default mapping beside WebSocket gateways", () => {
  test("a failing message handler keeps its WebSocket exception frame", async () => {
    const application = await AponiaFactory.create(FailingGatewayModule, { logger: false });
    const webSocketRoute = application
      .getNativeApplication()
      .routes.find((route) => route.method === "WS") as
      | { hooks?: Record<string, unknown> }
      | undefined;
    const message = webSocketRoute?.hooks?.message as
      | ((socket: unknown, message: unknown) => unknown)
      | undefined;
    const sent: unknown[] = [];

    expect(typeof message).toBe("function");
    await message!(
      { send: (data: unknown) => sent.push(data) },
      { event: "boom", data: "private detail" },
    );

    // The mapping is a route's own HTTP hook, so a gateway's native error frame
    // is what a client still receives and it carries no handler detail.
    expect(sent).toEqual([
      {
        event: "exception",
        data: {
          code: "WEBSOCKET_HANDLER_ERROR",
          message: "The WebSocket handler failed.",
        },
      },
    ]);
    await application.close();
  });
});
