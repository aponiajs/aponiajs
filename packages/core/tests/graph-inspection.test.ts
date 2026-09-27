import { expect, test } from "bun:test";
import {
  createToken,
  defineModule,
  provideValue,
  type ControllerDefinition,
  type ModuleDefinition,
} from "@aponiajs/common";
import { ModuleGraph, compileModuleGraph } from "../src/index.ts";

class InspectionController {}

const inspectionController: ControllerDefinition = {
  kind: "inspection",
  token: InspectionController,
  inject: [],
  useClass: InspectionController,
};

test("inspects controller, provider, import, and export names of every module", () => {
  const value = createToken<number>("inspection-value");
  const leaf = defineModule({
    id: "inspection-leaf",
    controllers: [inspectionController],
    providers: [provideValue(value, 1)],
    exports: [value],
  });
  const root = defineModule({ id: "inspection-root", imports: [leaf] });

  const inspection = compileModuleGraph(root).inspect();

  expect(inspection).toEqual({
    root: "inspection-root",
    modules: [
      {
        id: "inspection-leaf",
        imports: [],
        controllers: ["InspectionController"],
        providers: ["inspection-value"],
        exports: ["inspection-value"],
      },
      {
        id: "inspection-root",
        imports: ["inspection-leaf"],
        controllers: [],
        providers: [],
        exports: [],
      },
    ],
  });
  expect(Object.isFrozen(inspection)).toBe(true);
  expect(Object.isFrozen(inspection.modules)).toBe(true);
  expect(Object.isFrozen(inspection.modules[0]!.controllers)).toBe(true);
});

test("reports every import exporting the located token as an ambiguous lookup", () => {
  const value = createToken<number>("ambiguous-lookup-value");
  const left: ModuleDefinition = {
    id: "ambiguous-lookup-left",
    imports: [],
    controllers: [],
    providers: [provideValue(value, 1)],
    exports: [value],
  };
  const right: ModuleDefinition = {
    id: "ambiguous-lookup-right",
    imports: [],
    controllers: [],
    providers: [provideValue(value, 2)],
    exports: [value],
  };
  const root: ModuleDefinition = {
    id: "ambiguous-lookup-root",
    imports: [left, right],
    controllers: [],
    providers: [],
    exports: [],
  };
  const graph = new ModuleGraph(root, [left, right, root]);

  expect(() => graph.locate(root, value)).toThrow(
    expect.objectContaining({
      code: "AMBIGUOUS_PROVIDER",
      details: {
        module: "ambiguous-lookup-root",
        token: "ambiguous-lookup-value",
        candidates: ["ambiguous-lookup-left", "ambiguous-lookup-right"],
      },
    }),
  );
});
