import { describe, expect, test } from "bun:test";
import {
  Body,
  Catch,
  Controller,
  Get,
  Injectable,
  MessageBody,
  Module,
  Post,
  SubscribeMessage,
  UseFilters,
  WebSocketGateway,
  type LoggerService,
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

@Controller("validated")
class ValidatedController {
  @Post("items", { body: t.Object({ name: t.String() }) })
  create(@Body() body: { name: string }): { name: string } {
    return { name: body.name };
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
    ValidatedController,
    NativeController,
  ],
  providers: [NotFoundFilter, CatchAllFilter, UndecidedFilter, BrokenFilter, AsyncAnsweringFilter],
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

  log(): void {}

  fatal(): void {}

  warn(): void {}

  error(message: unknown, context?: unknown): void {
    this.errors.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }
}

describe("exception filters", () => {
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
