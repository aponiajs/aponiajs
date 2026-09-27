import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  provideFactory,
  provideValue,
  type ModuleDefinition,
} from "@aponiajs/common";
import { compileModuleGraph } from "../src/index.ts";

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected the operation to throw an AponiaError.");
}

function rawModule(
  id: string,
  imports: ModuleDefinition[],
  providers: ModuleDefinition["providers"] = [],
): ModuleDefinition {
  return { id, imports, controllers: [], providers, exports: [] };
}

describe("@aponiajs/core graph compilation edges", () => {
  test("reports a module that imports itself as a cycle through itself", () => {
    const imports: ModuleDefinition[] = [];
    const cyclic = rawModule("self", imports);
    imports.push(cyclic);

    const error = captureAponiaError(() => compileModuleGraph(cyclic));

    expect(error.code).toBe("MODULE_CYCLE");
    expect(error.details).toEqual({ cycle: ["self", "self"] });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  test("reports the full traversal path for an import cycle at depth", () => {
    const firstImports: ModuleDefinition[] = [];
    const secondImports: ModuleDefinition[] = [];
    const thirdImports: ModuleDefinition[] = [];
    const first = rawModule("depth-first", firstImports);
    const second = rawModule("depth-second", secondImports);
    const third = rawModule("depth-third", thirdImports);
    firstImports.push(second);
    secondImports.push(third);
    thirdImports.push(first);

    const error = captureAponiaError(() => compileModuleGraph(first));

    expect(error.code).toBe("MODULE_CYCLE");
    expect(error.details).toEqual({
      cycle: ["depth-first", "depth-second", "depth-third", "depth-first"],
    });
  });

  test("treats a shared instanceId on distinct module ids as one module identity", () => {
    const instanceId = Symbol("shared-instance");
    const alpha = defineModule({ id: "alpha", instanceId });
    const beta = defineModule({ id: "beta", instanceId });
    const root = defineModule({ id: "identity-root", imports: [alpha, beta] });

    const error = captureAponiaError(() => compileModuleGraph(root));

    expect(error.code).toBe("DUPLICATE_MODULE");
    expect(error.details).toEqual({ module: "beta" });
  });

  test("compiles a module imported twice through one definition only once", () => {
    const value = createToken<number>("repeated-value");
    const leaf = defineModule({
      id: "repeated-leaf",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const root = defineModule({ id: "repeated-root", imports: [leaf, leaf] });

    const graph = compileModuleGraph(root);

    expect(graph.modules).toEqual([leaf, root]);
    expect(Object.isFrozen(graph.modules)).toBe(true);
  });

  test("compiles a diamond import graph in depth-first order with each module once", () => {
    const value = createToken<number>("diamond-order-value");
    const source = defineModule({
      id: "order-source",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const left = defineModule({ id: "order-left", imports: [source], exports: [value] });
    const right = defineModule({ id: "order-right", imports: [source], exports: [value] });
    const root = defineModule({ id: "order-root", imports: [left, right] });

    const graph = compileModuleGraph(root);

    expect(graph.modules).toEqual([source, left, right, root]);
    expect(graph.inspect().modules.map((module) => module.id)).toEqual([
      "order-source",
      "order-left",
      "order-right",
      "order-root",
    ]);
  });

  test("reports cycles before declarations before exports before dependencies", () => {
    const duplicate = createToken<string>("precedence-duplicate");
    const missing = createToken<string>("precedence-missing");
    const result = createToken<string>("precedence-result");

    const imports: ModuleDefinition[] = [];
    const cyclic = rawModule("precedence-cycle", imports, [
      provideValue(duplicate, "first"),
      provideValue(duplicate, "second"),
    ]);
    imports.push(cyclic);

    const declaration = defineModule({
      id: "precedence-declaration",
      providers: [
        provideValue(duplicate, "first"),
        provideValue(duplicate, "second"),
        provideFactory(result, [missing] as const, (value) => value),
      ],
    });
    const exported = defineModule({
      id: "precedence-export",
      providers: [provideFactory(result, [missing] as const, (value) => value)],
      exports: [missing],
    });

    expect(captureAponiaError(() => compileModuleGraph(cyclic)).code).toBe("MODULE_CYCLE");
    expect(captureAponiaError(() => compileModuleGraph(declaration)).code).toBe(
      "DUPLICATE_PROVIDER",
    );
    expect(captureAponiaError(() => compileModuleGraph(exported)).code).toBe("INVALID_EXPORT");
  });

  test("rethrows an ambiguous re-export instead of reporting a missing export", () => {
    const value = createToken<number>("re-export-value");
    const left = defineModule({
      id: "re-export-left",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const right = defineModule({
      id: "re-export-right",
      providers: [provideValue(value, 2)],
      exports: [value],
    });
    const root = defineModule({
      id: "re-export-root",
      imports: [left, right],
      exports: [value],
    });

    const error = captureAponiaError(() => compileModuleGraph(root));

    expect(error.code).toBe("AMBIGUOUS_PROVIDER");
    expect(error.details).toEqual({
      module: "re-export-root",
      token: "re-export-value",
      candidates: ["re-export-left", "re-export-right"],
    });
  });
});
