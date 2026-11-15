import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Module,
  Param,
  Version,
  type AponiaMiddleware,
  type AponiaModule,
  type MiddlewareConsumer,
  type RouteContext,
} from "@aponiajs/common";
import { AponiaFactory, inspectAponiaApplication } from "../src/index.ts";

@Controller("users")
class UsersController {
  @Get()
  list(): { readonly ok: boolean } {
    return { ok: true };
  }

  @Get(":id")
  find(@Param("id") id: string): { readonly id: string } {
    return { id };
  }
}

@Controller("greet")
class GreetController {
  @Get()
  @Version("1")
  one(): { readonly version: number } {
    return { version: 1 };
  }

  @Get()
  @Version("2")
  two(): { readonly version: number } {
    return { version: 2 };
  }
}

class MarkerMiddleware implements AponiaMiddleware {
  async use(context: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    context.set.headers["x-marker"] = "present";
    return await next();
  }
}

@Module({ controllers: [UsersController, GreetController] })
class PrefixedModule implements AponiaModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MarkerMiddleware).forRoutes(UsersController);
  }
}

describe("global route prefix", () => {
  test("mounts compiled routes under the prefix and leaves the bare path unmounted", async () => {
    const application = await AponiaFactory.create(PrefixedModule, {
      logger: false,
      prefix: "/api",
    });

    try {
      const prefixed = await application.handle(new Request("http://localhost/api/users"));
      expect(prefixed.status).toBe(200);
      expect(await prefixed.json()).toEqual({ ok: true });

      const bare = await application.handle(new Request("http://localhost/users"));
      expect(bare.status).toBe(404);

      const parameterized = await application.handle(new Request("http://localhost/api/users/42"));
      expect(await parameterized.json()).toEqual({ id: "42" });
    } finally {
      await application.close();
    }
  });

  test("keeps a versioned route's segment after the prefix", async () => {
    const application = await AponiaFactory.create(PrefixedModule, {
      logger: false,
      prefix: "/api/",
    });

    try {
      const response = await application.handle(new Request("http://localhost/api/v2/greet"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ version: 2 });
    } finally {
      await application.close();
    }
  });

  test("rewrites header negotiation inside the prefix", async () => {
    const application = await AponiaFactory.create(PrefixedModule, {
      logger: false,
      prefix: "/api",
      versioning: { type: "header" },
    });

    try {
      const response = await application.handle(
        new Request("http://localhost/api/greet", {
          headers: { "x-api-version": "2" },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ version: 2 });
    } finally {
      await application.close();
    }
  });

  test("matches middleware targets against the unprefixed route", async () => {
    const application = await AponiaFactory.create(PrefixedModule, {
      logger: false,
      prefix: "/api",
    });

    try {
      const response = await application.handle(new Request("http://localhost/api/users"));
      expect(response.headers.get("x-marker")).toBe("present");

      const outside = await application.handle(new Request("http://localhost/users"));
      expect(outside.headers.get("x-marker")).toBeNull();
    } finally {
      await application.close();
    }
  });

  test("mounts health probes outside the prefix", async () => {
    const application = await AponiaFactory.create(PrefixedModule, {
      logger: false,
      prefix: "/api",
      health: true,
    });

    try {
      const ready = await application.handle(new Request("http://localhost/health/ready"));
      expect(ready.status).toBe(200);

      const prefixed = await application.handle(new Request("http://localhost/api/health/ready"));
      expect(prefixed.status).toBe(404);
    } finally {
      await application.close();
    }
  });

  test("treats an empty or root prefix as no prefix", async () => {
    for (const prefix of ["", "/"]) {
      const application = await AponiaFactory.create(PrefixedModule, { logger: false, prefix });
      try {
        const response = await application.handle(new Request("http://localhost/users"));
        expect(response.status).toBe(200);
      } finally {
        await application.close();
      }
    }
  });

  test("leaves a request naming only the prefix outside the route table", async () => {
    const application = await AponiaFactory.create(PrefixedModule, {
      logger: false,
      prefix: "/api",
    });

    try {
      const response = await application.handle(new Request("http://localhost/api"));
      expect(response.status).toBe(404);
    } finally {
      await application.close();
    }
  });

  test("refuses a prefix that does not begin with a slash", async () => {
    let failure: unknown;
    try {
      await AponiaFactory.create(PrefixedModule, { logger: false, prefix: "api" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "INVALID_CONFIGURATION_VALUE" });
  });

  test("refuses a prefix that is not a string", async () => {
    let failure: unknown;
    try {
      await AponiaFactory.create(PrefixedModule, {
        logger: false,
        prefix: 42 as unknown as string,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "INVALID_CONFIGURATION_VALUE" });
  });

  test("reports prefixed paths through inspection", () => {
    const inspection = inspectAponiaApplication(PrefixedModule, { prefix: "/api" });
    const paths = inspection.routes.map((route) => route.path);

    expect(paths).toContain("/api/users");
    expect(paths).toContain("/api/v2/greet");
  });
});
