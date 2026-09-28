import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type ModuleDefinition,
  type Provider,
} from "@aponiajs/common";
import { compileModuleGraph, createContainer, providerDependencies } from "../src/index.ts";

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

describe("@aponiajs/core provider shapes", () => {
  /** The object form the framework this one mirrors writes, with no `kind` on it. */
  function nestShapedProvider(provide: unknown, useValue: unknown): Provider {
    return { provide, useValue } as unknown as Provider;
  }

  test("refuses a provider written in the shape NestJS uses", () => {
    const token = createToken<number>("nest-shaped");
    const module = rawModule("app", [], [nestShapedProvider(token, 1)]);

    const error = captureAponiaError(() => compileModuleGraph(module));

    expect(error.code).toBe("INVALID_PROVIDER");
    expect(error.details).toEqual({
      module: "app",
      index: 0,
      problem: expect.any(String),
    });
    // The diagnosis, not the sentence: a reader has to learn that the kind is what
    // is missing, because that is the one field the shape they wrote does not have.
    expect(error.details.problem).toContain("kind");
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  test("names the position of the entry that is wrong rather than the module alone", () => {
    const token = createToken<number>("placed");
    const module = rawModule(
      "app",
      [],
      [
        provideValue(token, 1),
        { kind: "clazz", provide: token, useValue: 1 } as unknown as Provider,
      ],
    );

    const error = captureAponiaError(() => compileModuleGraph(module));

    expect(error.code).toBe("INVALID_PROVIDER");
    expect(error.details).toMatchObject({ module: "app", index: 1 });
  });

  test("refuses an entry that is not an object at all", () => {
    const module = rawModule("app", [], ["provideValue(token, 1)" as unknown as Provider]);

    const error = captureAponiaError(() => compileModuleGraph(module));

    expect(error.code).toBe("INVALID_PROVIDER");
    expect(error.details).toMatchObject({ module: "app", index: 0 });
  });

  test("refuses a class provider whose inject list is not a list", () => {
    class Service {}

    const module = rawModule(
      "app",
      [],
      [
        {
          kind: "class",
          provide: Service,
          useClass: Service,
          inject: "none",
        } as unknown as Provider,
      ],
    );

    const error = captureAponiaError(() => compileModuleGraph(module));

    expect(error.code).toBe("INVALID_PROVIDER");
    expect(error.details).toMatchObject({ module: "app", index: 0 });
  });

  test("accepts every kind the factories build", () => {
    const value = createToken<string>("value");
    const alias = createToken<string>("alias");
    const factory = createToken<number>("factory");

    class Service {}

    const container = createContainer(
      rawModule(
        "app",
        [],
        [
          provideValue(value, "a value"),
          provideAlias(alias, value),
          provideFactory(factory, [value], (name) => name.length),
          provideClass(Service, []),
        ],
      ),
    );

    expect(container.get(value)).toBe("a value");
    expect(container.get(alias)).toBe("a value");
    expect(container.get(factory)).toBe("a value".length);
    expect(container.get(Service)).toBeInstanceOf(Service);
  });

  test("refuses a kind it cannot read when it is asked directly", () => {
    // `providerDependencies` is the graph rule the platform reads without building
    // a graph, so it is reachable with nothing in front of it — and answering
    // `undefined` to a caller that iterates the answer is how a wrong-shaped
    // provider became a `TypeError` two frames away from the entry at fault.
    const error = captureAponiaError(() =>
      providerDependencies({ kind: "clazz" } as unknown as Provider),
    );

    expect(error.code).toBe("INVALID_PROVIDER");
    expect(error.details).toEqual({ kind: "clazz" });
  });
});
