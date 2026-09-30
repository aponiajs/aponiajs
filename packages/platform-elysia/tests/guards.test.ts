import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  defineModule,
  provideClass,
  type ClassToken,
  type ExecutionContext,
  type RequestMethod,
  type RouteContext,
} from "@aponiajs/common";
import { AponiaFactory, defineControllerRoutes, type AponiaApplication } from "../src/index.ts";

const calls: string[] = [];

@Injectable()
class AllowGuard {
  canActivate(): boolean {
    calls.push("allow");
    return true;
  }
}

@Injectable()
class DenyGuard {
  canActivate(): boolean {
    calls.push("deny");
    return false;
  }
}

@Injectable()
class AsyncDenyGuard {
  async canActivate(): Promise<boolean> {
    calls.push("async-deny");
    return false;
  }
}

@Injectable()
class GlobalAllowGuard {
  canActivate(): boolean {
    calls.push("global-allow");
    return true;
  }
}

@Injectable()
class GlobalDenyGuard {
  canActivate(): boolean {
    calls.push("global-deny");
    return false;
  }
}

@Controller("open")
class OpenController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Controller("denied")
@UseGuards(DenyGuard)
class DeniedController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Controller("ordered")
@UseGuards(AllowGuard, AsyncDenyGuard)
class OrderedController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Module({
  controllers: [OpenController, DeniedController, OrderedController],
  providers: [AllowGuard, DenyGuard, AsyncDenyGuard, GlobalAllowGuard, GlobalDenyGuard],
})
class AppModule {}

/**
 * What each accessor answered for the one request the probe guard let through.
 *
 * The guard records the values itself, from the context the platform handed a
 * real request, so a case asserts what a guard is actually given rather than
 * what a context built in isolation would answer.
 */
interface ContextProbe {
  handler?: (...arguments_: never[]) => unknown;
  controller?: ClassToken<unknown>;
  route?: Readonly<{ readonly method: RequestMethod; readonly path: string }>;
  context?: RouteContext;
  request?: RouteContext;
}

const probe: ContextProbe = {};

@Injectable()
class ContextProbeGuard {
  canActivate(context: ExecutionContext): boolean {
    calls.push("probe");
    probe.handler = context.getHandler();
    probe.controller = context.getClass<ProbeController>();
    probe.route = context.getRoute();
    probe.context = context.getContext();
    probe.request = context.switchToHttp().getRequest();

    return true;
  }
}

@Controller("probe")
@UseGuards(ContextProbeGuard)
class ProbeController {
  @Get()
  // The handler never reads `this`, which the annotation states so that a case
  // can hold the method itself as the handler a guard is given.
  read(this: void): string {
    calls.push("handler");
    return "probe";
  }
}

@Module({ controllers: [ProbeController], providers: [ContextProbeGuard] })
class ProbeModule {}

@Controller("feature")
class FeatureController {
  @Get()
  read(): string {
    calls.push("handler");
    return "feature";
  }
}

@Module({ controllers: [FeatureController] })
class FeatureModule {}

// The global enhancer is a provider of the root module, which is what a global
// declaration resolves through: the controller's own module never names it.
@Module({ imports: [FeatureModule], providers: [GlobalDenyGuard] })
class FeatureRootModule {}

// Never declared anywhere, so no module can reach it.
@Injectable()
class UndeclaredGlobalGuard {
  canActivate(): boolean {
    calls.push("undeclared");
    return true;
  }
}

// Declared without being exported, so only the module that declares it can
// reach it, and a global declaration resolves through the root.
@Injectable()
class ModulePrivateGlobalGuard {
  canActivate(): boolean {
    calls.push("module-private");
    return true;
  }
}

@Module({ providers: [ModulePrivateGlobalGuard] })
class GuardHolderModule {}

@Module({ imports: [GuardHolderModule] })
class UnreachableGlobalModule {}

class DeclaredDenyGuard {
  canActivate(): boolean {
    calls.push("declared-deny");
    return false;
  }
}

class DeclaredController {
  read(): string {
    calls.push("handler");
    return "read";
  }
}

// The descriptor path states its guards in the plan, where no decorator ran.
const declaredGuardModule = defineModule({
  id: "DeclaredGuardModule",
  providers: [provideClass(DeclaredDenyGuard, [])],
  controllers: [
    defineControllerRoutes(DeclaredController, {
      path: "declared",
      routes: [{ method: "GET", path: "", propertyKey: "read", guards: [DeclaredDenyGuard] }],
    }),
  ],
});

// A declared controller that declares no enhancer of its own, so anything that
// refuses its route came from the application.
const declaredOpenModule = defineModule({
  id: "DeclaredOpenModule",
  providers: [provideClass(GlobalDenyGuard, [])],
  controllers: [
    defineControllerRoutes(DeclaredController, {
      path: "declared-open",
      routes: [{ method: "GET", path: "", propertyKey: "read" }],
    }),
  ],
});

/**
 * The hook object Elysia mounted for one path, which is what a boot compiled for
 * that route made observable.
 */
function mountedHooks(application: AponiaApplication, path: string): Record<string, unknown> {
  const route = application
    .getNativeApplication()
    .routes.find((candidate) => candidate.path === path);
  if (route === undefined) {
    throw new Error(`The application mounted no route at ${path}.`);
  }

  return (route.hooks ?? {}) as unknown as Record<string, unknown>;
}

describe("guards", () => {
  test("a refusing guard answers Problem Details 403 and never calls the handler", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/denied"));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(calls).toEqual(["deny"]);
    await application.close();
  });

  test("guards run in declaration order and an async guard can refuse", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/ordered"));

    expect(response.status).toBe(403);
    expect(calls).toEqual(["allow", "async-deny"]);
    await application.close();
  });

  test("a controller with no guards calls its handler and records nothing", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/open"));

    expect([response.status, await response.text()]).toEqual([200, "read"]);
    expect(calls).toEqual(["handler"]);
    await application.close();
  });

  test("a route that declares no enhancer mounts no guard hook", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const hooks = mountedHooks(application, "/open");

    // A route with no enhancers mounts the hooks its schema declares and nothing
    // else, so the lifecycle a route carrying guards gains is absent here rather
    // than present and inert. The response proves the route is mounted.
    expect(hooks.beforeHandle).toBeUndefined();
    expect(hooks.afterHandle).toBeUndefined();
    const response = await application.handle(new Request("http://localhost/open"));
    expect([response.status, await response.text()]).toEqual([200, "read"]);

    await application.close();
  });
});

describe("the context a guard receives", () => {
  test("each accessor answers the controller, the handler, and the mounted route", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(ProbeModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/probe"));

    // The guard allowed the request, so everything below states the contract on
    // the successful path: the guard ran first, the handler answered.
    expect([response.status, await response.text()]).toEqual([200, "probe"]);
    expect(calls).toEqual(["probe", "handler"]);

    expect(probe.controller).toBe(ProbeController);
    // The handler is the controller's own method, not the platform's invoker, so
    // a guard recognises the route it protects the way Nest code does.
    expect(probe.handler).toBe(ProbeController.prototype.read);
    expect(probe.route).toEqual({ method: "GET", path: "/probe" });
    // `switchToHttp().getRequest()` and `getContext()` are the same object, which
    // is the request the context describes.
    expect(probe.request).toBe(probe.context);
    expect(probe.context?.request.url).toBe("http://localhost/probe");
    expect(probe.context?.path).toBe("/probe");

    await application.close();
  });
});

describe("global guards", () => {
  test("a global guard refuses a route whose controller declares none", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, {
      logger: false,
      guards: [GlobalDenyGuard],
    });

    const response = await application.handle(new Request("http://localhost/open"));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(calls).toEqual(["global-deny"]);
    await application.close();
  });

  test("a global guard runs before the ones the route declares", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(AppModule, {
      logger: false,
      guards: [GlobalAllowGuard],
    });

    const response = await application.handle(new Request("http://localhost/ordered"));

    expect(response.status).toBe(403);
    expect(calls).toEqual(["global-allow", "allow", "async-deny"]);
    await application.close();
  });

  test("a global guard reaches a controller in an imported module", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(FeatureRootModule, {
      logger: false,
      guards: [GlobalDenyGuard],
    });

    const response = await application.handle(new Request("http://localhost/feature"));

    expect(response.status).toBe(403);
    expect(calls).toEqual(["global-deny"]);
    await application.close();
  });

  test("a global guard no module declares fails the boot with MISSING_PROVIDER", async () => {
    expect(
      AponiaFactory.create(AppModule, { logger: false, guards: [UndeclaredGlobalGuard] }),
    ).rejects.toThrow(expect.objectContaining({ code: "MISSING_PROVIDER" }));
  });

  test("a global guard only a feature module can reach fails the boot with MISSING_PROVIDER", async () => {
    expect(
      AponiaFactory.create(UnreachableGlobalModule, {
        logger: false,
        guards: [ModulePrivateGlobalGuard],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "MISSING_PROVIDER" }));
  });
});

describe("guards on the declared-descriptor path", () => {
  test("a guard the plan declares refuses with the same Problem Details 403", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(declaredGuardModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/declared"));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(calls).toEqual(["declared-deny"]);
    await application.close();
  });

  test("a global guard refuses a declared controller's route too", async () => {
    calls.length = 0;
    const application = await AponiaFactory.create(declaredOpenModule, {
      logger: false,
      guards: [GlobalDenyGuard],
    });

    const response = await application.handle(new Request("http://localhost/declared-open"));

    expect(response.status).toBe(403);
    expect(calls).toEqual(["global-deny"]);
    await application.close();
  });
});
