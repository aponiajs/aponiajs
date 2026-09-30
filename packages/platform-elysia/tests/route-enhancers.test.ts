import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  MessageBody,
  Module,
  SubscribeMessage,
  UseFilters,
  UseGuards,
  UseInterceptors,
  WebSocketGateway,
  defineModule,
  provideClass,
} from "@aponiajs/common";
import { AponiaFactory, defineElysiaControllerRoutes } from "../src/index.ts";
import { compileElysiaRoutes } from "../src/routing/route-compiler.ts";

const gatewayGuardCalls: string[] = [];

class AuthGuard {
  canActivate(): boolean {
    return true;
  }
}

class MethodGuard {
  canActivate(): boolean {
    return true;
  }
}

class AuditInterceptor {
  interceptBefore(): void {
    return;
  }
}

class MethodInterceptor {
  interceptBefore(): void {
    return;
  }
}

class ReportingFilter {
  catch(): undefined {
    return undefined;
  }
}

class MethodFilter {
  catch(): undefined {
    return undefined;
  }
}

class GatewayGuard {
  canActivate(): boolean {
    gatewayGuardCalls.push("gateway");
    return true;
  }
}

@Injectable()
@UseGuards(AuthGuard)
@Controller("plain")
class PlainController {
  @Get()
  read(): string {
    return "read";
  }
}

@Controller("open")
class OpenController {
  @Get()
  read(): string {
    return "open";
  }
}

@UseGuards(AuthGuard)
@UseInterceptors(AuditInterceptor)
@UseFilters(ReportingFilter)
@Controller("scoped")
class ScopedController {
  @UseGuards(MethodGuard)
  @Get("guarded")
  guarded(): string {
    return "guarded";
  }

  @UseInterceptors(MethodInterceptor)
  @UseFilters(MethodFilter)
  @Get("declared")
  declared(): string {
    return "declared";
  }

  @Get("bare")
  bare(): string {
    return "bare";
  }
}

class DeclaredController {
  read(): string {
    return "declared";
  }
}

@Module({ controllers: [PlainController, OpenController], providers: [AuthGuard] })
class AppModule {}

@UseGuards(GatewayGuard)
@WebSocketGateway("/guarded")
class GuardedGateway {
  @SubscribeMessage("echo")
  echo(@MessageBody() data: unknown): unknown {
    return data;
  }
}

@Module({ providers: [GatewayGuard, GuardedGateway] })
class GuardedGatewayModule {}

describe("compiled route enhancers", () => {
  test("a controller that declares no enhancer gains one error hook and nothing else", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });
    const open = application
      .getNativeApplication()
      .routes.find((route) => route.path === "/open") as
      | { hooks?: Record<string, unknown> }
      | undefined;
    const errorHooks = open?.hooks?.error as
      | readonly ((...arguments_: never[]) => unknown)[]
      | undefined;

    expect(open?.hooks?.beforeHandle).toBeUndefined();
    expect(open?.hooks?.afterHandle).toBeUndefined();
    // The default mapping is compiled into every route's own `error` array, so
    // that array is the one hook a route declaring no enhancer gains. It is
    // synchronous, which is what leaves the route compiling the way it compiled
    // before the mapping existed. Elysia 2 keeps a route's hooks as bare
    // handlers, so the array entry is the mapping itself.
    expect(Object.keys(open?.hooks ?? {})).toEqual(["error"]);
    expect(errorHooks).toHaveLength(1);
    expect(typeof errorHooks?.[0]).toBe("function");
    expect(errorHooks?.[0]?.constructor.name).not.toBe("AsyncFunction");
    await application.close();
  });

  test("a controller that declares a guard still mounts without error", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(application.getNativeApplication().routes.map((route) => route.path)).toContain(
      "/plain",
    );
    await application.close();
  });

  test("joins a controller's own declarations with its handler's in scope order", () => {
    const routes = new Map(
      compileElysiaRoutes(ScopedController, "scoped").map((route) => [route.path, route]),
    );

    // A handler that declares one kind keeps the controller's other two.
    // Guards go outward-in, so the controller's declaration comes first; filters
    // run most-specific-first, so the handler's own come first there.
    expect(routes.get("/scoped/guarded")?.enhancers).toEqual({
      guards: [AuthGuard, MethodGuard],
      interceptors: [AuditInterceptor],
      filters: [ReportingFilter],
    });
    expect(routes.get("/scoped/declared")?.enhancers).toEqual({
      guards: [AuthGuard],
      interceptors: [AuditInterceptor, MethodInterceptor],
      filters: [MethodFilter, ReportingFilter],
    });
    expect(routes.get("/scoped/bare")?.enhancers).toEqual({
      guards: [AuthGuard],
      interceptors: [AuditInterceptor],
      filters: [ReportingFilter],
    });
  });

  test("carries frozen empty enhancer metadata for a route that declares none", () => {
    const [open] = compileElysiaRoutes(OpenController, "open");

    expect(open?.enhancers).toEqual({ guards: [], interceptors: [], filters: [] });
    expect(Object.isFrozen(open?.enhancers)).toBe(true);
    expect(Object.isFrozen(open?.enhancers.guards)).toBe(true);
    expect(Object.isFrozen(open?.enhancers.interceptors)).toBe(true);
    expect(Object.isFrozen(open?.enhancers.filters)).toBe(true);
  });
});

describe("declared route enhancers", () => {
  test("carries the enhancers a declared plan states, copied and frozen", async () => {
    const declaredGuards = [AuthGuard];
    const definition = defineElysiaControllerRoutes(DeclaredController, {
      path: "/declared",
      routes: [
        {
          method: "GET",
          path: "full",
          propertyKey: "read",
          guards: declaredGuards,
          interceptors: [AuditInterceptor],
          filters: [ReportingFilter],
        },
        { method: "GET", path: "bare", propertyKey: "read" },
      ],
    });
    const [full, bare] = definition.compiledRoutes;

    expect(full?.enhancers).toEqual({
      guards: [AuthGuard],
      interceptors: [AuditInterceptor],
      filters: [ReportingFilter],
    });
    expect(bare?.enhancers).toEqual({ guards: [], interceptors: [], filters: [] });
    expect(Object.isFrozen(full?.enhancers)).toBe(true);
    expect(Object.isFrozen(full?.enhancers.guards)).toBe(true);

    // The plan's collections are copied, so a caller that keeps its own array
    // cannot change what the compiled route declares.
    declaredGuards.push(MethodGuard);
    expect(full?.enhancers.guards).toEqual([AuthGuard]);
  });

  test("mounts a declared controller whose plan declares enhancers", async () => {
    const module = defineModule({
      id: "DeclaredEnhancerModule",
      providers: [
        provideClass(AuthGuard, []),
        provideClass(AuditInterceptor, []),
        provideClass(ReportingFilter, []),
      ],
      controllers: [
        defineElysiaControllerRoutes(DeclaredController, {
          path: "/declared",
          routes: [
            {
              method: "GET",
              path: "full",
              propertyKey: "read",
              guards: [AuthGuard],
              interceptors: [AuditInterceptor],
              filters: [ReportingFilter],
            },
          ],
        }),
      ],
    });
    const application = await AponiaFactory.create(module, { logger: false });

    const response = await application.handle(new Request("http://localhost/declared/full"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("declared");
    await application.close();
  });
});

describe("enhancer declarations on a gateway", () => {
  test("ignores enhancer decorators on a WebSocket gateway", async () => {
    const application = await AponiaFactory.create(GuardedGatewayModule, { logger: false });
    const wsRoute = application
      .getNativeApplication()
      .routes.find((route) => route.method === "WS") as
      | { path?: string; hooks?: Record<string, unknown> }
      | undefined;
    const message = wsRoute?.hooks?.message as
      | ((socket: unknown, message: unknown) => unknown)
      | undefined;
    const sent: unknown[] = [];

    expect(wsRoute?.path).toBe("/guarded");
    expect(typeof message).toBe("function");
    await message!({ send: (data: unknown) => sent.push(data) }, { event: "echo", data: "hello" });

    // A gateway is a class provider, not a controller, and a message handler is
    // not a route, so the guard is never consulted for message dispatch.
    expect(sent).toEqual([{ event: "echo", data: "hello" }]);
    expect(gatewayGuardCalls).toEqual([]);
    await application.close();
  });
});
