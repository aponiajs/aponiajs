import { expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  createToken,
  provideValue,
  type DynamicModule,
} from "@aponiajs/common";
import { AponiaFactory, compileRootModule } from "../src/index.ts";

@Injectable()
class BaseMergeService {
  read(): string {
    return "base";
  }
}

@Controller("merge-base")
class BaseMergeController {
  constructor(private readonly service: BaseMergeService) {}

  @Get()
  read(): string {
    return this.service.read();
  }
}

@Module({
  controllers: [BaseMergeController],
  providers: [BaseMergeService],
  exports: [BaseMergeService],
})
class MergeBaseModule {}

@Controller("merge-dynamic")
class DynamicMergeController {
  @Get()
  read(): string {
    return "dynamic";
  }
}

@Module({ controllers: [DynamicMergeController] })
class DynamicMergeImportModule {}

const dynamicMergeValue = createToken<string>("merge.dynamic-value");

const mergedDynamicModule: DynamicModule = {
  module: MergeBaseModule,
  id: "MergedEdgeModule",
  instanceId: Symbol("merged-edge-module"),
  imports: [DynamicMergeImportModule],
  controllers: [DynamicMergeController],
  providers: [provideValue(dynamicMergeValue, "configured")],
  exports: [dynamicMergeValue],
};

test("merges decorated module metadata with the dynamic module that configures it", () => {
  const compiled = compileRootModule(mergedDynamicModule);

  expect(compiled.id).toBe("MergedEdgeModule");
  expect(compiled.instanceId).toBe(mergedDynamicModule.instanceId);
  expect(compiled.imports.map((module) => module.id)).toEqual(["DynamicMergeImportModule"]);
  expect(compiled.controllers.map((controller) => controller.token)).toEqual([
    BaseMergeController,
    DynamicMergeController,
  ]);
  expect(compiled.providers).toEqual([
    {
      kind: "class",
      provide: BaseMergeService,
      inject: [],
      useClass: BaseMergeService,
    },
    {
      kind: "value",
      provide: dynamicMergeValue,
      useValue: "configured",
    },
  ]);
  expect(compiled.exports).toEqual([BaseMergeService, dynamicMergeValue]);
  expect(Object.isFrozen(compiled)).toBe(true);
  expect(Object.isFrozen(compiled.imports)).toBe(true);
  expect(Object.isFrozen(compiled.controllers)).toBe(true);
  expect(Object.isFrozen(compiled.providers)).toBe(true);
  expect(Object.isFrozen(compiled.exports)).toBe(true);
});

test("mounts the decorated and dynamic controllers of a merged module together", async () => {
  const application = await AponiaFactory.create(mergedDynamicModule, { logger: false });
  const base = await application.handle(new Request("http://localhost/merge-base"));
  const dynamic = await application.handle(new Request("http://localhost/merge-dynamic"));

  expect(await base.text()).toBe("base");
  expect(await dynamic.text()).toBe("dynamic");
  await application.close();
});

test("keeps a class module free of the dynamic module that configures it", () => {
  const merged = compileRootModule(mergedDynamicModule);
  const classOnly = compileRootModule(MergeBaseModule);

  expect(merged.controllers).toHaveLength(2);
  expect(classOnly.id).toBe("MergeBaseModule");
  expect(classOnly.instanceId).toBeUndefined();
  expect(classOnly.imports).toEqual([]);
  expect(classOnly.controllers.map((controller) => controller.token)).toEqual([
    BaseMergeController,
  ]);
  expect(classOnly.providers).toHaveLength(1);
  expect(classOnly.exports).toEqual([BaseMergeService]);
});
