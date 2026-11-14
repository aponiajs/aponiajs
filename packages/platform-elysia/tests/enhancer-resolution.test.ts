import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  UseFilters,
  UseGuards,
  UseInterceptors,
  defineModule,
  getTokenName,
  type EnhancerMetadata,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import { AponiaContainer, compileModuleGraph } from "@aponiajs/core";
import { AponiaFactory, compileRootModule, defineControllerRoutes } from "../src/index.ts";
import {
  collectEnhancerDeclarations,
  resolveEnhancers,
  type ResolvedControllerEnhancers,
} from "../src/controllers/enhancer-resolver.ts";
import { compileElysiaRoutes } from "../src/routing/route-compiler.ts";

// An enhancer is resolved while its controller mounts, so an application in
// which one cannot resolve never finishes booting. The two facts the first
// cases prove therefore need one application each.

@Injectable()
class UndeclaredGuard {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class DeclaredGuard {
  canActivate(): boolean {
    return true;
  }
}

@Controller("undeclared")
@UseGuards(UndeclaredGuard)
class UndeclaredGuardController {
  @Get()
  read(): string {
    return "undeclared";
  }
}

@Controller("declared")
@UseGuards(DeclaredGuard)
class DeclaredGuardController {
  @Get()
  read(): string {
    return "declared";
  }
}

@Module({ controllers: [UndeclaredGuardController] })
class UndeclaredGuardModule {}

@Module({ controllers: [DeclaredGuardController], providers: [DeclaredGuard] })
class DeclaredGuardModule {}

@Injectable()
class ModulePrivateGuard {
  canActivate(): boolean {
    return true;
  }
}

@Controller("unreachable")
@UseGuards(ModulePrivateGuard)
class UnreachableGuardController {
  @Get()
  read(): string {
    return "unreachable";
  }
}

// Declares the guard without exporting it, so the importing module cannot reach
// it even though it is a provider in the graph.
@Module({ providers: [ModulePrivateGuard] })
class ModulePrivateGuardModule {}

@Module({ imports: [ModulePrivateGuardModule], controllers: [UnreachableGuardController] })
class UnreachableGuardModule {}

@Injectable()
class ExportedGuard {
  canActivate(): boolean {
    return true;
  }
}

@Controller("reachable")
@UseGuards(ExportedGuard)
class ReachableGuardController {
  @Get()
  read(): string {
    return "reachable";
  }
}

@Module({ providers: [ExportedGuard], exports: [ExportedGuard] })
class ExportedGuardModule {}

@Module({ imports: [ExportedGuardModule], controllers: [ReachableGuardController] })
class ReachableGuardModule {}

class PlannedController {
  read(): string {
    return "planned";
  }
}

// The descriptor path states its enhancers in the plan, where no decorator ran,
// so it reaches resolution through the same compiled route.
const UndeclaredPlannedGuardModule = defineModule({
  id: "UndeclaredPlannedGuardModule",
  controllers: [
    defineControllerRoutes(PlannedController, {
      path: "planned",
      routes: [{ method: "GET", path: "", propertyKey: "read", guards: [UndeclaredGuard] }],
    }),
  ],
});

class FirstGuard {
  canActivate(): boolean {
    return true;
  }
}

class SecondGuard {
  canActivate(): boolean {
    return true;
  }
}

class AuditInterceptor {
  interceptBefore(): void {
    return;
  }
}

class NotFoundError extends Error {}

@Catch(NotFoundError)
class NotFoundFilter {
  catch(): undefined {
    return undefined;
  }
}

@Catch()
class CatchEverythingFilter {
  catch(): undefined {
    return undefined;
  }
}

@Controller("scoped")
@UseGuards(FirstGuard)
@UseInterceptors(AuditInterceptor)
@UseFilters(NotFoundFilter)
class ScopedController {
  @Get("first")
  first(): string {
    return "first";
  }

  @UseGuards(SecondGuard)
  @UseFilters(CatchEverythingFilter)
  @Get("second")
  second(): string {
    return "second";
  }
}

@Module({
  controllers: [ScopedController],
  providers: [FirstGuard, SecondGuard, AuditInterceptor, NotFoundFilter, CatchEverythingFilter],
})
class ScopedModule {}

// Never declared as a provider, and never part of a controller's declarations.
class UnresolvedGuard {
  canActivate(): boolean {
    return true;
  }
}

/** Records every token the container is asked to resolve, in order. */
class CountingContainer extends AponiaContainer {
  readonly resolvedTokens: string[] = [];

  override resolveModuleProvider<TValue>(module: ModuleDefinition, token: Token<TValue>): TValue {
    this.resolvedTokens.push(getTokenName(token));
    return super.resolveModuleProvider(module, token);
  }
}

function resolveScopedController(): {
  readonly container: CountingContainer;
  readonly module: ModuleDefinition;
  readonly resolved: ResolvedControllerEnhancers;
  readonly routes: ReturnType<typeof compileElysiaRoutes>;
} {
  const module = compileRootModule(ScopedModule);
  const container = new CountingContainer(compileModuleGraph(module));
  const routes = compileElysiaRoutes(ScopedController, "scoped");

  return {
    container,
    module,
    resolved: resolveEnhancers(container, module, collectEnhancerDeclarations(routes)),
    routes,
  };
}

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected the resolver to raise an AponiaError.");
}

describe("resolving the enhancers of a mounted controller", () => {
  test("an undeclared enhancer class fails the mount with MISSING_PROVIDER", async () => {
    expect(AponiaFactory.create(UndeclaredGuardModule, { logger: false })).rejects.toThrow(
      expect.objectContaining({ code: "MISSING_PROVIDER" }),
    );
  });

  test("a declared enhancer class resolves and the controller's route mounts", async () => {
    const application = await AponiaFactory.create(DeclaredGuardModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/declared"));

    expect([response.status, await response.text()]).toEqual([200, "declared"]);
    await application.close();
  });

  test("an enhancer its module keeps private fails the importer's mount with MISSING_PROVIDER", async () => {
    expect(AponiaFactory.create(UnreachableGuardModule, { logger: false })).rejects.toThrow(
      expect.objectContaining({ code: "MISSING_PROVIDER" }),
    );
  });

  test("an enhancer an imported module exports resolves for the importer", async () => {
    const application = await AponiaFactory.create(ReachableGuardModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/reachable"));

    expect([response.status, await response.text()]).toEqual([200, "reachable"]);
    await application.close();
  });

  test("an undeclared enhancer a declared plan names fails the mount with MISSING_PROVIDER", async () => {
    expect(AponiaFactory.create(UndeclaredPlannedGuardModule, { logger: false })).rejects.toThrow(
      expect.objectContaining({ code: "MISSING_PROVIDER" }),
    );
  });
});

describe("resolving one controller's enhancers", () => {
  test("resolves each distinct class once, in first-declaration order", () => {
    const { container, resolved } = resolveScopedController();

    // FirstGuard is declared by both routes and NotFoundFilter by both; each is
    // asked of the container once.
    expect(container.resolvedTokens).toEqual([
      "FirstGuard",
      "SecondGuard",
      "AuditInterceptor",
      "NotFoundFilter",
      "CatchEverythingFilter",
    ]);
    expect(resolved.guards[0]).toBeInstanceOf(FirstGuard);
    expect(resolved.guards[1]).toBeInstanceOf(SecondGuard);
    expect(resolved.interceptors[0]).toBeInstanceOf(AuditInterceptor);
    expect(resolved.filters[0]?.instance).toBeInstanceOf(NotFoundFilter);
    expect(resolved.filters[1]?.instance).toBeInstanceOf(CatchEverythingFilter);
  });

  test("assembles each route's ordered lists from the shared instances", () => {
    const { container, resolved, routes } = resolveScopedController();

    const first = resolved.forRoute(routes[0]!.enhancers);
    const second = resolved.forRoute(routes[1]!.enhancers);

    expect(first.guards).toHaveLength(1);
    expect(first.guards[0]).toBe(resolved.guards[0]);
    expect(second.guards).toHaveLength(2);
    expect(second.guards[0]).toBe(resolved.guards[0]);
    expect(second.guards[1]).toBe(resolved.guards[1]);
    expect(first.interceptors[0]).toBe(resolved.interceptors[0]);
    expect(second.interceptors[0]).toBe(resolved.interceptors[0]);
    expect(first.filters[0]).toBe(resolved.filters[0]);
    // Filters run most-specific-first, so the filter the handler declares itself
    // is consulted before the one its controller declares.
    expect(second.filters[0]).toBe(resolved.filters[1]);
    expect(second.filters[1]).toBe(resolved.filters[0]);
    // Assembling a route's lists resolves nothing: the instances are shared.
    expect(container.resolvedTokens).toHaveLength(5);
  });

  test("carries each filter's own @Catch types as read", () => {
    const { resolved, routes } = resolveScopedController();

    const first = resolved.forRoute(routes[0]!.enhancers);
    const second = resolved.forRoute(routes[1]!.enhancers);

    expect(resolved.filters[0]?.catch).toEqual([NotFoundError]);
    expect(first.filters[0]?.catch).toEqual([NotFoundError]);
    // A filter declared with no exceptions catches anything.
    expect(resolved.filters[1]?.catch).toEqual([]);
    expect(second.filters[0]?.catch).toEqual([]);
  });

  test("returns frozen data", () => {
    const { resolved, routes } = resolveScopedController();
    const first = resolved.forRoute(routes[0]!.enhancers);

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.guards)).toBe(true);
    expect(Object.isFrozen(resolved.interceptors)).toBe(true);
    expect(Object.isFrozen(resolved.filters)).toBe(true);
    expect(Object.isFrozen(resolved.filters[0])).toBe(true);
    expect(Object.isFrozen(resolved.filters[0]?.catch)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.guards)).toBe(true);
  });

  test("resolves nothing for a controller that declares no enhancer", () => {
    const module = compileRootModule(ScopedModule);
    const container = new CountingContainer(compileModuleGraph(module));
    const resolved = resolveEnhancers(container, module, collectEnhancerDeclarations([]));

    expect(container.resolvedTokens).toEqual([]);
    expect(resolved.guards).toEqual([]);
    expect(resolved.interceptors).toEqual([]);
    expect(resolved.filters).toEqual([]);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  test("assembling a list that names an unresolved class fails with MISSING_PROVIDER", () => {
    const { container, resolved } = resolveScopedController();
    const metadata: EnhancerMetadata = {
      guards: [UnresolvedGuard],
      interceptors: [],
      filters: [],
    };

    const error = captureAponiaError(() => resolved.forRoute(metadata));

    expect(error.code).toBe("MISSING_PROVIDER");
    // The class was never resolved, so assembling it never reached the container.
    expect(container.resolvedTokens).toHaveLength(5);
  });
});

describe("collecting a controller's enhancer declarations", () => {
  test("keeps every route's declarations, in route order", () => {
    const routes = compileElysiaRoutes(ScopedController, "scoped");

    const declarations = collectEnhancerDeclarations(routes);

    // A class both routes name appears once per route: resolution is cached by
    // class, and each route keeps the run order it declared. Filters declare
    // themselves most-specific-first, so the handler's own precede the
    // controller's within one route.
    expect(declarations.guards).toEqual([FirstGuard, FirstGuard, SecondGuard]);
    expect(declarations.interceptors).toEqual([AuditInterceptor, AuditInterceptor]);
    expect(declarations.filters).toEqual([NotFoundFilter, CatchEverythingFilter, NotFoundFilter]);
    expect(Object.isFrozen(declarations)).toBe(true);
    expect(Object.isFrozen(declarations.guards)).toBe(true);
  });
});
