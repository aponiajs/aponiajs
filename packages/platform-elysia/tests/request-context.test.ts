import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Controller,
  createToken,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { RequestContextModule } from "../src/request-context/request-context-module.ts";
import { RequestContextService } from "../src/request-context/request-context.service.ts";
import type { RequestContext } from "../src/request-context/request-context.types.ts";

const TENANT_TOKEN = createToken<string>("test.tenant");
const USER_TOKEN = createToken<{ id: string; role: string }>("test.user");

@Injectable()
class TestAuthGuard implements CanActivate {
  readonly #context: RequestContextService;

  constructor(context: RequestContextService) {
    this.#context = context;
  }

  canActivate(_execution: ExecutionContext): boolean {
    const current = this.#context.current();
    current?.set(TENANT_TOKEN, "tenant-acme");
    current?.set(USER_TOKEN, { id: "user-123", role: "admin" });
    return true;
  }
}

@Injectable()
class OrderRepository {
  readonly #context: RequestContextService;

  constructor(context: RequestContextService) {
    this.#context = context;
  }

  fetchOrderDetails() {
    const current = this.#context.current();
    return {
      requestId: current?.requestId,
      tenant: current?.get(TENANT_TOKEN),
      user: current?.get(USER_TOKEN),
      unknown: current?.get(createToken<string>("unknown")),
      hasRequest: current?.request instanceof Request,
      url: current?.request.url,
    };
  }
}

@Injectable()
class OrderService {
  readonly #repo: OrderRepository;

  constructor(repo: OrderRepository) {
    this.#repo = repo;
  }

  process() {
    return this.#repo.fetchOrderDetails();
  }
}

@Controller("/orders")
class OrderController {
  readonly #service: OrderService;
  readonly #context: RequestContextService;

  constructor(service: OrderService, context: RequestContextService) {
    this.#service = service;
    this.#context = context;
  }

  @Get("/reach")
  @UseGuards(TestAuthGuard)
  reach() {
    return this.#service.process();
  }

  @Get("/delayed")
  async delayed() {
    const idBefore = this.#context.current()?.requestId;
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20) + 5));
    const idAfter = this.#context.current()?.requestId;
    return { idBefore, idAfter };
  }

  @Get("/throw")
  fail() {
    throw new Error("Deliberate controller failure");
  }
}

describe("RequestContextModule integration", () => {
  test("current() answers undefined when outside any request", () => {
    const service = new RequestContextService();
    expect(service.current()).toBeUndefined();

    // Verify constructor with and without storage
    const customStorage = new AsyncLocalStorage<RequestContext>();
    const customService = new RequestContextService(customStorage);
    expect(customService.current()).toBeUndefined();

    // Verify class constructor instantiation
    const moduleInstance = new RequestContextModule();
    expect(moduleInstance).toBeInstanceOf(RequestContextModule);
  });

  test("RequestContextModule.forRoot() produces a dynamic module exporting RequestContextService", () => {
    const dynamicModule = RequestContextModule.forRoot();
    expect(dynamicModule.id).toBe("AponiaRequestContextModule");
    expect(dynamicModule.exports).toContain(RequestContextService);
    expect(dynamicModule.providers).toHaveLength(2);
  });

  test("reach: context is accessible deep in the call stack across guards, services, and repositories", async () => {
    const requestContext = RequestContextModule.forRoot();

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/orders/reach", {
        headers: { "x-request-id": "client-corr-id-99" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("client-corr-id-99");

    const payload = (await response.json()) as {
      requestId: string;
      tenant: string;
      user: { id: string; role: string };
      unknown: unknown;
      hasRequest: boolean;
      url: string;
    };

    expect(payload.requestId).toBe("client-corr-id-99");
    expect(payload.tenant).toBe("tenant-acme");
    expect(payload.user).toEqual({ id: "user-123", role: "admin" });
    expect(payload.unknown).toBeUndefined();
    expect(payload.hasRequest).toBe(true);
    expect(payload.url).toBe("http://localhost/orders/reach");
  });

  test("error path: default Problem Details response preserves x-request-id header", async () => {
    const requestContext = RequestContextModule.forRoot();

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/orders/throw", {
        headers: { "x-request-id": "failed-req-trace-42" },
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("failed-req-trace-42");
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("concurrency: concurrent asynchronous requests remain strictly isolated", async () => {
    const requestContext = RequestContextModule.forRoot();

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    const count = 20;

    const promises = Array.from({ length: count }, async (_, index) => {
      const sentId = `concurrent-req-${index}`;
      const response = await app.handle(
        new Request("http://localhost/orders/delayed", {
          headers: { "x-request-id": sentId },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe(sentId);

      const body = (await response.json()) as { idBefore: string; idAfter: string };
      return { sentId, ...body };
    });

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result.idBefore).toBe(result.sentId);
      expect(result.idAfter).toBe(result.sentId);
    }
  });

  test("header resolution: generates fallback UUID on missing header and echoes it", async () => {
    const requestContext = RequestContextModule.forRoot();

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/orders/reach"));

    expect(response.status).toBe(200);
    const echoedId = response.headers.get("x-request-id");
    expect(typeof echoedId).toBe("string");
    expect(echoedId?.length).toBeGreaterThan(10);

    const body = (await response.json()) as { requestId: string };
    expect(body.requestId).toBe(echoedId!);
  });

  test("header resolution: replaces invalid or dangerous header with generated UUID", async () => {
    const requestContext = RequestContextModule.forRoot();

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    const overlongId = "a".repeat(300);
    const response = await app.handle(
      new Request("http://localhost/orders/reach", {
        headers: { "x-request-id": overlongId },
      }),
    );

    expect(response.status).toBe(200);
    const echoedId = response.headers.get("x-request-id");
    expect(echoedId).not.toBe(overlongId);
    expect(typeof echoedId).toBe("string");
    expect(echoedId?.length).toBeLessThan(100);

    const body = (await response.json()) as { requestId: string };
    expect(body.requestId).toBe(echoedId!);
  });

  test("options.echo: false suppresses the response header while keeping context active", async () => {
    const requestContext = RequestContextModule.forRoot({ echo: false });

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/orders/reach", {
        headers: { "x-request-id": "no-echo-id" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeNull();

    const body = (await response.json()) as { requestId: string };
    expect(body.requestId).toBe("no-echo-id");
  });

  test("custom options: custom header name and generator", async () => {
    const requestContext = RequestContextModule.forRoot({
      header: "x-correlation-id",
      generate: () => "custom-gen-100",
    });

    @Module({
      imports: [requestContext],
      controllers: [OrderController],
      providers: [OrderService, OrderRepository, TestAuthGuard],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    // With custom header present
    const res1 = await app.handle(
      new Request("http://localhost/orders/reach", {
        headers: { "x-correlation-id": "client-trace-555" },
      }),
    );
    expect(res1.status).toBe(200);
    expect(res1.headers.get("x-correlation-id")).toBe("client-trace-555");
    const body1 = (await res1.json()) as { requestId: string };
    expect(body1.requestId).toBe("client-trace-555");

    // With custom header absent -> fallback to generator
    const res2 = await app.handle(new Request("http://localhost/orders/reach"));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-correlation-id")).toBe("custom-gen-100");
    const body2 = (await res2.json()) as { requestId: string };
    expect(body2.requestId).toBe("custom-gen-100");
  });

  test("opt-out: application without RequestContextModule has no correlation headers", async () => {
    @Controller("/simple")
    class SimpleController {
      @Get("/")
      index() {
        return { status: "ok" };
      }
    }

    @Module({
      controllers: [SimpleController],
    })
    class PlainAppModule {}

    const app = await AponiaFactory.create(PlainAppModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/simple"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeNull();
  });
});
