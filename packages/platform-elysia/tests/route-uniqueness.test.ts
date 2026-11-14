import { expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Module,
  Post,
  type DynamicModule,
  type ModuleDefinition,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import {
  AponiaFactory,
  PluginModule,
  compileRootModule,
  inspectAponiaApplication,
} from "../src/index.ts";
import { Elysia } from "elysia";

@Controller("same-module")
class FirstSameModuleController {
  @Get()
  read(): string {
    return "first";
  }
}

@Controller("same-module")
class SecondSameModuleController {
  @Get()
  read(): string {
    return "second";
  }
}

@Module({ controllers: [FirstSameModuleController, SecondSameModuleController] })
class SameModuleCollisionModule {}

@Controller("across-modules")
class FirstAcrossModuleController {
  @Get()
  read(): string {
    return "first";
  }
}

@Module({ controllers: [FirstAcrossModuleController] })
class FirstAcrossModule {}

@Controller("across-modules")
class SecondAcrossModuleController {
  @Get()
  read(): string {
    return "second";
  }
}

@Module({ controllers: [SecondAcrossModuleController] })
class SecondAcrossModule {}

@Module({ imports: [FirstAcrossModule, SecondAcrossModule] })
class AcrossModuleCollisionRoot {}

@Controller("in-class")
class InClassDuplicateController {
  @Get()
  first(): string {
    return "first";
  }

  @Get()
  second(): string {
    return "second";
  }
}

@Module({ controllers: [InClassDuplicateController] })
class InClassDuplicateModule {}

@Controller("method-scoped")
class MethodScopedController {
  @Get()
  read(): string {
    return "get";
  }

  @Post()
  write(): string {
    return "post";
  }
}

@Module({ controllers: [MethodScopedController] })
class MethodScopedModule {}

@Controller("merged-dynamic")
class RepeatedMergedController {
  @Get()
  read(): string {
    return "dynamic";
  }
}

@Module({ controllers: [RepeatedMergedController] })
class MergedImportModule {}

@Controller("merged-base")
class MergedBaseController {
  @Get()
  read(): string {
    return "base";
  }
}

@Module({ controllers: [MergedBaseController] })
class MergedBaseModule {}

const mergedRootModule: DynamicModule = {
  module: MergedBaseModule,
  id: "MergedRoot",
  instanceId: Symbol("merged-root"),
  imports: [MergedImportModule],
  controllers: [RepeatedMergedController],
};

@Controller("declared-twice")
class DeclaredTwiceController {
  @Get()
  read(): string {
    return "declared-twice";
  }
}

@Module({ controllers: [DeclaredTwiceController, DeclaredTwiceController] })
class RepeatedControllerModule {}

@Controller("shared-resource")
class SharedResourceController {
  @Get()
  read(): string {
    return "shared";
  }
}

@Module({ controllers: [SharedResourceController] })
class SharedResourceModule {}

@Module({ imports: [SharedResourceModule] })
class FirstConsumerModule {}

@Module({ imports: [SharedResourceModule] })
class SecondConsumerModule {}

@Module({ imports: [FirstConsumerModule, SecondConsumerModule] })
class ReuseRootModule {}

const plugin = new Elysia({ name: "route-uniqueness-plugin" })
  .get("/plugin-shared", () => "plugin")
  .get("/plugin-only", () => "plugin-only");
const pluginModule = PluginModule.register(plugin, { key: "route-uniqueness" });

@Controller("plugin-shared")
class PluginSharedController {
  @Get()
  read(): string {
    return "controller";
  }
}

@Module({ controllers: [PluginSharedController] })
class PluginSharedControllerModule {}

@Module({ imports: [pluginModule, PluginSharedControllerModule] })
class PluginSharedRootModule {}

test("rejects two controllers of one module claiming the same method and path", () => {
  const error = captureAponiaError(() => compileRootModule(SameModuleCollisionModule));

  expect(error.code).toBe("DUPLICATE_ROUTE");
  expect(error.details).toEqual({
    method: "GET",
    path: "/same-module",
    modules: ["SameModuleCollisionModule", "SameModuleCollisionModule"],
    controllers: ["FirstSameModuleController", "SecondSameModuleController"],
    handlers: ["read", "read"],
  });
  expect(Object.isFrozen(error.details)).toBe(true);
  expect(Object.isFrozen(error.details?.modules)).toBe(true);
  expect(Object.isFrozen(error.details?.controllers)).toBe(true);
  expect(Object.isFrozen(error.details?.handlers)).toBe(true);
});

test("rejects two controllers of imported modules claiming the same method and path", () => {
  const error = captureAponiaError(() => compileRootModule(AcrossModuleCollisionRoot));

  expect(error.code).toBe("DUPLICATE_ROUTE");
  // The claim is recorded in graph order, which is the order bootstrap mounts.
  expect(error.details).toEqual({
    method: "GET",
    path: "/across-modules",
    modules: ["FirstAcrossModule", "SecondAcrossModule"],
    controllers: ["FirstAcrossModuleController", "SecondAcrossModuleController"],
    handlers: ["read", "read"],
  });
});

test("refuses the colliding application before it can serve a request", async () => {
  const raised: unknown = await AponiaFactory.create(AcrossModuleCollisionRoot, {
    logger: false,
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(raised).toEqual(expect.objectContaining({ code: "DUPLICATE_ROUTE" }));
});

test("rejects two handlers of one controller claiming the same method and path", () => {
  const error = captureAponiaError(() => compileRootModule(InClassDuplicateModule));

  expect(error.code).toBe("DUPLICATE_ROUTE");
  expect(error.details).toEqual({
    method: "GET",
    path: "/in-class",
    modules: ["InClassDuplicateModule", "InClassDuplicateModule"],
    controllers: ["InClassDuplicateController", "InClassDuplicateController"],
    handlers: ["first", "second"],
  });
});

test("keeps distinct methods on one path", async () => {
  const application = await AponiaFactory.create(MethodScopedModule, { logger: false });

  const read = await application.handle(
    new Request("http://localhost/method-scoped", { method: "GET" }),
  );
  const write = await application.handle(
    new Request("http://localhost/method-scoped", { method: "POST" }),
  );

  expect(await read.text()).toBe("get");
  expect(await write.text()).toBe("post");
  await application.close();
});

test("mounts one controller named by a dynamic module and by a module it imports", async () => {
  // Both MergedRoot and MergedImportModule declare RepeatedMergedController, so
  // the route registers twice. Every registration repeats the same controller
  // method, so the route is unambiguous and stays supported.
  const routes = inspectAponiaApplication(mergedRootModule).routes.filter(
    (route) => route.path === "/merged-dynamic",
  );
  expect(routes).toHaveLength(2);

  const application = await AponiaFactory.create(mergedRootModule, { logger: false });
  const base = await application.handle(new Request("http://localhost/merged-base"));
  const dynamic = await application.handle(new Request("http://localhost/merged-dynamic"));

  expect(await base.text()).toBe("base");
  expect(await dynamic.text()).toBe("dynamic");
  await application.close();
});

test("mounts a reusable module imported by two modules exactly once", async () => {
  const modules = inspectAponiaApplication(ReuseRootModule).modules.map((module) => module.id);
  expect(modules).toEqual([
    "SharedResourceModule",
    "FirstConsumerModule",
    "SecondConsumerModule",
    "ReuseRootModule",
  ]);

  const application = await AponiaFactory.create(ReuseRootModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/shared-resource"));

  expect(await response.text()).toBe("shared");
  await application.close();
});

test("keeps a route a native plugin provides beside a controller's", async () => {
  const application = await AponiaFactory.create(PluginSharedRootModule, { logger: false });

  const shared = await application.handle(new Request("http://localhost/plugin-shared"));
  const pluginOnly = await application.handle(new Request("http://localhost/plugin-only"));

  // Which one answers the shared path is Elysia's documented `use()` override
  // behavior and follows `elysia.aot`, so only the controller's own claim is
  // Aponia's to reject. Here it must not.
  expect(["plugin", "controller"]).toContain(await shared.text());
  expect(await pluginOnly.text()).toBe("plugin-only");
  await application.close();
});

test("leaves a controller one module declares twice to the module graph", () => {
  expect(() => compileRootModule(RepeatedControllerModule)).not.toThrow();
  expect(() => createContainer(compileRootModule(RepeatedControllerModule))).toThrow(
    expect.objectContaining({ code: "DUPLICATE_PROVIDER" }),
  );
});

test("walks a hand-written descriptor cycle once and leaves it to the graph", () => {
  const imports: ModuleDefinition[] = [];
  const selfImporting: ModuleDefinition = {
    id: "SelfImportingModule",
    imports,
    controllers: [],
    providers: [],
    exports: [],
  };
  imports.push(selfImporting);

  expect(() => compileRootModule(selfImporting)).not.toThrow();
  expect(() => createContainer(selfImporting)).toThrow(
    expect.objectContaining({ code: "MODULE_CYCLE" }),
  );
});

test("raises DUPLICATE_ROUTE through inspection, which compiles the same path", () => {
  expect(() => inspectAponiaApplication(SameModuleCollisionModule)).toThrow(
    expect.objectContaining({ code: "DUPLICATE_ROUTE" }),
  );
});

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected the application definition to raise an AponiaError.");
}
