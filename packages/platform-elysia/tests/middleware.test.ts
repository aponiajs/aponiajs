import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  type AponiaMiddleware,
  type AponiaModule,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

@Injectable()
class TraceService {
  getPrefix(): string {
    return "APONIA-TRACE";
  }
}

@Injectable()
class InjectedAuthMiddleware implements AponiaMiddleware {
  #trace: TraceService;

  constructor(trace: TraceService) {
    this.#trace = trace;
  }

  async use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    const authHeader = context.request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer valid-token")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "x-trace-id": this.#trace.getPrefix(),
        },
      });
    }

    context.set.headers["x-trace-id"] = this.#trace.getPrefix();
    return await next();
  }
}

class OnionTrackerMiddleware implements AponiaMiddleware {
  static order: string[] = [];

  async use(_context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    OnionTrackerMiddleware.order.push("mw1-before");
    const result = await next();
    OnionTrackerMiddleware.order.push("mw1-after");
    return result;
  }
}

class SecondOnionMiddleware implements AponiaMiddleware {
  async use(_context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    OnionTrackerMiddleware.order.push("mw2-before");
    const result = await next();
    OnionTrackerMiddleware.order.push("mw2-after");
    return result;
  }
}

@Controller("users")
class UsersController {
  @Get()
  getUsers() {
    return { users: ["alice", "bob"] };
  }

  @Get("profile")
  getProfile() {
    return { profile: "user-profile" };
  }
}

@Controller("public")
class PublicController {
  @Get("health")
  getHealth() {
    return { status: "ok" };
  }
}

@Module({
  controllers: [UsersController, PublicController],
  providers: [TraceService, InjectedAuthMiddleware],
})
class TestMiddlewareModule implements AponiaModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply onion tracker on all routes
    consumer.apply(OnionTrackerMiddleware, SecondOnionMiddleware).forRoutes("*");

    // Apply injected auth middleware to UsersController, excluding public
    consumer.apply(InjectedAuthMiddleware).exclude("public/*").forRoutes(UsersController);
  }
}

describe("Middleware System in Platform Elysia", () => {
  test("executes middleware in onion order around route handlers", async () => {
    OnionTrackerMiddleware.order = [];
    const app = await AponiaFactory.create(TestMiddlewareModule, { logger: false });

    const response = await app.handle(new Request("http://localhost/public/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });

    expect(OnionTrackerMiddleware.order).toEqual([
      "mw1-before",
      "mw2-before",
      "mw2-after",
      "mw1-after",
    ]);
  });

  test("resolves middleware via DI and short-circuits on unauthorized request", async () => {
    const app = await AponiaFactory.create(TestMiddlewareModule, { logger: false });

    const unauthResponse = await app.handle(new Request("http://localhost/users"));
    expect(unauthResponse.status).toBe(401);
    expect(unauthResponse.headers.get("x-trace-id")).toBe("APONIA-TRACE");
    expect(await unauthResponse.json()).toEqual({ error: "Unauthorized" });

    const authResponse = await app.handle(
      new Request("http://localhost/users", {
        headers: { authorization: "Bearer valid-token" },
      }),
    );
    expect(authResponse.status).toBe(200);
    expect(authResponse.headers.get("x-trace-id")).toBe("APONIA-TRACE");
    expect(await authResponse.json()).toEqual({ users: ["alice", "bob"] });
  });

  test("respects excluded routes", async () => {
    const app = await AponiaFactory.create(TestMiddlewareModule, { logger: false });

    // /public/health is excluded from InjectedAuthMiddleware, so no 401
    const response = await app.handle(new Request("http://localhost/public/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("matches controller target subroutes", async () => {
    const app = await AponiaFactory.create(TestMiddlewareModule, { logger: false });

    const response = await app.handle(new Request("http://localhost/users/profile"));
    expect(response.status).toBe(401);
  });
});
