import { Controller, Get, Module, type DynamicModule } from "@aponiajs/common";
import { Elysia } from "elysia";
import {
  AponiaFactory,
  ElysiaPluginModule,
  compileRootModule,
  inspectAponiaApplication,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("conformance-duplicate")
class ConformanceFirstController {
  @Get()
  read(): string {
    return "first";
  }
}

@Controller("conformance-duplicate")
class ConformanceSecondController {
  @Get()
  read(): string {
    return "second";
  }
}

@Module({ controllers: [ConformanceFirstController, ConformanceSecondController] })
class ConformanceCollisionModule {}

@Controller("conformance-imported-duplicate")
class ConformanceImportedFirstController {
  @Get()
  read(): string {
    return "first";
  }
}

@Module({ controllers: [ConformanceImportedFirstController] })
class ConformanceFirstModule {}

@Controller("conformance-imported-duplicate")
class ConformanceImportedSecondController {
  @Get()
  read(): string {
    return "second";
  }
}

@Module({ controllers: [ConformanceImportedSecondController] })
class ConformanceSecondModule {}

@Module({ imports: [ConformanceFirstModule, ConformanceSecondModule] })
class ConformanceCollisionRootModule {}

@Controller("conformance-merged")
class ConformanceRepeatedController {
  @Get()
  read(): string {
    return "merged";
  }
}

@Module({ controllers: [ConformanceRepeatedController] })
class ConformanceMergedImportModule {}

@Module({ controllers: [] })
class ConformanceMergedBaseModule {}

const conformanceMergedRoot: DynamicModule = {
  module: ConformanceMergedBaseModule,
  id: "ConformanceMergedRoot",
  instanceId: Symbol("conformance-merged-root"),
  imports: [ConformanceMergedImportModule],
  controllers: [ConformanceRepeatedController],
};

@Controller("conformance-shared")
class ConformanceSharedController {
  @Get()
  read(): string {
    return "shared";
  }
}

@Module({ controllers: [ConformanceSharedController] })
class ConformanceSharedModule {}

@Module({ imports: [ConformanceSharedModule] })
class ConformanceFirstConsumerModule {}

@Module({ imports: [ConformanceSharedModule] })
class ConformanceSecondConsumerModule {}

@Module({ imports: [ConformanceFirstConsumerModule, ConformanceSecondConsumerModule] })
class ConformanceReuseRootModule {}

const conformancePluginModule = ElysiaPluginModule.register(
  new Elysia({ name: "conformance-route-uniqueness-plugin" }).get(
    "/conformance-plugin-shared",
    () => "plugin",
  ),
  { key: "conformance-route-uniqueness" },
);

@Controller("conformance-plugin-shared")
class ConformancePluginSharedController {
  @Get()
  read(): string {
    return "controller";
  }
}

@Module({ controllers: [ConformancePluginSharedController] })
class ConformancePluginSharedControllerModule {}

@Module({ imports: [conformancePluginModule, ConformancePluginSharedControllerModule] })
class ConformancePluginRootModule {}

test("the Vite+ lane rejects two controllers claiming one method and path", () => {
  expect(() => compileRootModule(ConformanceCollisionModule)).toThrow(
    expect.objectContaining({
      code: "DUPLICATE_ROUTE",
      details: {
        method: "GET",
        path: "/conformance-duplicate",
        modules: ["ConformanceCollisionModule", "ConformanceCollisionModule"],
        controllers: ["ConformanceFirstController", "ConformanceSecondController"],
        handlers: ["read", "read"],
      },
    }),
  );
});

test("the Vite+ lane rejects a collision across imported modules and through inspection", () => {
  const expected = expect.objectContaining({
    code: "DUPLICATE_ROUTE",
    details: expect.objectContaining({ path: "/conformance-imported-duplicate" }),
  });

  expect(() => compileRootModule(ConformanceCollisionRootModule)).toThrow(expected);
  expect(() => inspectAponiaApplication(ConformanceCollisionRootModule)).toThrow(expected);
});

test("the Vite+ lane mounts one controller that two reachable modules declare", async () => {
  const application = await AponiaFactory.create(conformanceMergedRoot, { logger: false });
  const response = await application.handle(new Request("http://localhost/conformance-merged"));

  expect(await response.text()).toBe("merged");
  await application.close();
});

test("the Vite+ lane mounts a reusable module and a plugin route beside a controller's", async () => {
  const reusable = await AponiaFactory.create(ConformanceReuseRootModule, { logger: false });
  const shared = await reusable.handle(new Request("http://localhost/conformance-shared"));

  expect(await shared.text()).toBe("shared");
  await reusable.close();

  const overridden = await AponiaFactory.create(ConformancePluginRootModule, { logger: false });
  const response = await overridden.handle(
    new Request("http://localhost/conformance-plugin-shared"),
  );

  // Which registration answers is Elysia's `use()` override behavior, which
  // follows `elysia.aot`, so the path only has to keep answering.
  expect(["plugin", "controller"]).toContain(await response.text());
  await overridden.close();
});
