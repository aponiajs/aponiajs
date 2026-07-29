import {
  createToken,
  defineModule,
  provideFactory,
  provideValue,
  type ControllerDefinition,
} from "@aponiajs/common";
import { compileModuleGraph, createContainer } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("core resolves a typed singleton graph in the Vite+ lane", () => {
  const value = createToken<number>("value");
  const doubled = createToken<number>("doubled");
  const module = defineModule({
    id: "core-conformance",
    providers: [
      provideValue(value, 2),
      provideFactory(doubled, [value] as const, (item) => item * 2),
    ],
    exports: [doubled],
  });

  expect(createContainer(module).get(doubled)).toBe(4);
});

test("the Vite+ lane rejects duplicate provider and controller tokens", () => {
  const value = createToken<number>("duplicate-value");
  const duplicateProviders = defineModule({
    id: "duplicate-providers",
    providers: [provideValue(value, 1), provideValue(value, 2)],
  });

  class DuplicateController {}
  const controller: ControllerDefinition = {
    kind: "test",
    token: DuplicateController,
    inject: [],
    useClass: DuplicateController,
  };
  const duplicateControllers = defineModule({
    id: "duplicate-controllers",
    controllers: [controller, controller],
  });

  expect(() => compileModuleGraph(duplicateProviders)).toThrow(
    expect.objectContaining({ code: "DUPLICATE_PROVIDER" }),
  );
  expect(() => compileModuleGraph(duplicateControllers)).toThrow(
    expect.objectContaining({ code: "DUPLICATE_PROVIDER" }),
  );
});

test("the Vite+ lane rejects unresolvable graph dependencies", () => {
  const missing = createToken<string>("missing");
  const result = createToken<string>("result");
  const providerModule = defineModule({
    id: "missing-provider-dependency",
    providers: [provideFactory(result, [missing] as const, (value) => value)],
  });

  class MissingDependencyController {}
  const controller: ControllerDefinition = {
    kind: "test",
    token: MissingDependencyController,
    inject: [missing],
    useClass: MissingDependencyController,
  };
  const controllerModule = defineModule({
    id: "missing-controller-dependency",
    controllers: [controller],
  });

  expect(() => compileModuleGraph(providerModule)).toThrow(
    expect.objectContaining({ code: "MISSING_PROVIDER" }),
  );
  expect(() => compileModuleGraph(controllerModule)).toThrow(
    expect.objectContaining({ code: "MISSING_PROVIDER" }),
  );
});
