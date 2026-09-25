import { describe, expect, test } from "bun:test";
import {
  createToken,
  defineModule,
  provideFactory,
  provideValue,
  type ControllerDefinition,
} from "@aponiajs/common";
import { compileModuleGraph, createContainer } from "../src/index.ts";

describe("@aponiajs/core module graph lookup", () => {
  test("prefers the module's own provider over imports exporting the same token", () => {
    const value = createToken<number>("shadow-value");
    const leftProvider = provideValue(value, 1);
    const rightProvider = provideValue(value, 2);
    const rootProvider = provideValue(value, 3);
    const left = defineModule({
      id: "shadow-left",
      providers: [leftProvider],
      exports: [value],
    });
    const right = defineModule({
      id: "shadow-right",
      providers: [rightProvider],
      exports: [value],
    });
    const root = defineModule({
      id: "shadow-root",
      imports: [left, right],
      providers: [rootProvider],
    });

    const graph = compileModuleGraph(root);

    expect(graph.locate(root, value).provider).toBe(rootProvider);
    expect(graph.locate(root, value).module).toBe(root);
    expect(graph.locate(left, value).provider).toBe(leftProvider);
    expect(graph.locate(right, value).provider).toBe(rightProvider);
    expect(createContainer(root).get(value)).toBe(3);
  });

  test("memoizes the lookup result for repeated module resolutions", () => {
    const value = createToken<number>("memoized-value");
    const source = defineModule({
      id: "memoized-source",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const root = defineModule({ id: "memoized-root", imports: [source] });

    const graph = compileModuleGraph(root);
    const rootLookup = graph.locate(root, value);
    const sourceLookup = graph.locate(source, value);

    expect(graph.locate(root, value)).toBe(rootLookup);
    expect(graph.locate(source, value)).toBe(sourceLookup);
    expect(Object.isFrozen(rootLookup)).toBe(true);
    expect(Object.isFrozen(sourceLookup)).toBe(true);
    expect(rootLookup.module).toBe(source);
    expect(rootLookup.provider.provide).toBe(value);
    expect(sourceLookup.module).toBe(source);
  });

  test("requires an intermediate module to re-export a token before importers resolve it", () => {
    const value = createToken<number>("visibility-value");
    const doubled = createToken<number>("visibility-doubled");
    const source = defineModule({
      id: "visibility-source",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const middle = defineModule({
      id: "visibility-middle",
      imports: [source],
      providers: [provideFactory(doubled, [value] as const, (item) => item * 2)],
    });
    const root = defineModule({ id: "visibility-root", imports: [middle] });

    const container = createContainer(root);

    expect(container.resolveModuleProvider(middle, doubled)).toBe(2);
    expect(() => container.get(value)).toThrow(
      expect.objectContaining({
        code: "MISSING_PROVIDER",
        details: { module: "visibility-root", token: "visibility-value" },
      }),
    );
  });

  test("reports controller and provider names through a frozen inspection", () => {
    const value = createToken<number>("inspection-value");

    class InspectionController {}
    const controller: ControllerDefinition = {
      kind: "test",
      token: InspectionController,
      inject: [],
      useClass: InspectionController,
    };
    const module = defineModule({
      id: "inspection",
      providers: [provideValue(value, 1)],
      controllers: [controller],
      exports: [value],
    });

    const inspection = compileModuleGraph(module).inspect();

    expect(inspection).toEqual({
      root: "inspection",
      modules: [
        {
          id: "inspection",
          imports: [],
          controllers: ["InspectionController"],
          providers: ["inspection-value"],
          exports: ["inspection-value"],
        },
      ],
    });
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection.modules)).toBe(true);
    expect(Object.isFrozen(inspection.modules[0]?.controllers)).toBe(true);
    expect(Object.isFrozen(inspection.modules[0]?.providers)).toBe(true);
  });
});
