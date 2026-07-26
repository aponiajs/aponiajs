import { expect, test } from "bun:test";
import { Module, type DynamicModule, type ModuleImport } from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import { Elysia } from "elysia";
import { ElysiaPluginModule, compileRootModule } from "../src/index.ts";

@Module({})
class DynamicTestModule {}

test("rejects self-referencing and two-node dynamic module cycles", () => {
  const selfImports: ModuleImport[] = [];
  const self = createDynamicModule("SelfDynamicModule", selfImports);
  selfImports.push(self);

  expect(() => compileRootModule(self)).toThrow(expect.objectContaining({ code: "MODULE_CYCLE" }));

  const firstImports: ModuleImport[] = [];
  const secondImports: ModuleImport[] = [];
  const first = createDynamicModule("FirstDynamicModule", firstImports);
  const second = createDynamicModule("SecondDynamicModule", secondImports);
  firstImports.push(second);
  secondImports.push(first);

  expect(() => compileRootModule(first)).toThrow(expect.objectContaining({ code: "MODULE_CYCLE" }));
});

test("keeps static and separately configured instances of one module class", () => {
  const first = ElysiaPluginModule.register(new Elysia(), {
    key: "compiler-first",
  });
  const second = ElysiaPluginModule.register(new Elysia(), {
    key: "compiler-second",
  });
  const root = createDynamicModule("ConfiguredInstancesRoot", [ElysiaPluginModule, first, second]);

  const graph = createContainer(compileRootModule(root)).graph;

  expect(graph.modules.map((module) => module.id)).toEqual([
    "ElysiaPluginModule",
    "ElysiaPluginModule[compiler-first]",
    "ElysiaPluginModule[compiler-second]",
    "ConfiguredInstancesRoot",
  ]);
});

test("rejects two configured modules with the same stable key", () => {
  const first = ElysiaPluginModule.register(new Elysia(), {
    key: "compiler-duplicate",
  });
  const second = ElysiaPluginModule.register(new Elysia(), {
    key: "compiler-duplicate",
  });
  const root = createDynamicModule("DuplicateConfiguredRoot", [first, second]);

  expect(() => createContainer(compileRootModule(root))).toThrow(
    expect.objectContaining({ code: "DUPLICATE_MODULE" }),
  );
});

test("rejects empty and whitespace-only stable keys", () => {
  expect(() => ElysiaPluginModule.register(new Elysia(), { key: "" })).toThrow(
    "Elysia plugin module key must not be empty.",
  );
  expect(() => ElysiaPluginModule.register(new Elysia(), { key: "   " })).toThrow(
    "Elysia plugin module key must not be empty.",
  );
});

function createDynamicModule(id: string, imports: readonly ModuleImport[]): DynamicModule {
  return {
    module: DynamicTestModule,
    id,
    instanceId: Symbol(id),
    imports,
  };
}
