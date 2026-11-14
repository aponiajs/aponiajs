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
        details: expect.objectContaining({ module: "visibility-root", token: "visibility-value" }),
      }),
    );
  });

  test("provides actionable diagnostic hints when a provider is missing", () => {
    const unexportedToken = createToken<string>("unexported-token");
    const unimportedExportedToken = createToken<string>("unimported-exported-token");
    const unimportedUnexportedToken = createToken<string>("unimported-unexported-token");
    const nowhereToken = createToken<string>("nowhere-token");

    const helperModule = defineModule({
      id: "helper-module",
      providers: [provideValue(unexportedToken, "helper-val")],
      exports: [], // declared in imported module, but not exported
    });

    const foreignModule = defineModule({
      id: "foreign-module",
      providers: [
        provideValue(unimportedExportedToken, "exported-val"),
        provideValue(unimportedUnexportedToken, "unexported-val"),
      ],
      exports: [unimportedExportedToken],
    });

    const consumerModule = defineModule({
      id: "consumer-module",
      imports: [helperModule], // imports helperModule, but not foreignModule
    });

    const fullRoot = defineModule({
      id: "full-root",
      imports: [consumerModule, foreignModule],
    });

    const graph = compileModuleGraph(fullRoot);

    // Scenario 1: Token declared in imported module, but not exported
    try {
      graph.locate(consumerModule, unexportedToken);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error: any) {
      expect(error.code).toBe("MISSING_PROVIDER");
      expect(error.details.hints).toBeDefined();
      expect(Object.isFrozen(error.details.hints)).toBe(true);
      expect(error.details.hints[0]).toContain(
        'Token "unexported-token" is declared in imported module "helper-module", but "helper-module" does not export it. Add "unexported-token" to "helper-module.exports".',
      );
      expect(error.message).toContain("Hints:");
    }

    // Scenario 2: Token exported by an unimported module
    try {
      graph.locate(consumerModule, unimportedExportedToken);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error: any) {
      expect(error.code).toBe("MISSING_PROVIDER");
      expect(error.details.hints[0]).toContain(
        'Token "unimported-exported-token" is exported by module "foreign-module", but "consumer-module" does not import "foreign-module". Add "foreign-module" to "consumer-module.imports".',
      );
    }

    // Scenario 3: Token declared in an unimported, unexported module
    try {
      graph.locate(consumerModule, unimportedUnexportedToken);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error: any) {
      expect(error.code).toBe("MISSING_PROVIDER");
      expect(error.details.hints[0]).toContain(
        'Token "unimported-unexported-token" is declared in module "foreign-module". Add "foreign-module" to "consumer-module.imports" and add "unimported-unexported-token" to "foreign-module.exports".',
      );
    }

    // Scenario 4: Token not declared anywhere in graph
    try {
      graph.locate(consumerModule, nowhereToken);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error: any) {
      expect(error.code).toBe("MISSING_PROVIDER");
      expect(error.details.hints[0]).toContain(
        'No module in the compiled graph declares token "nowhere-token". Did you forget to add it to "consumer-module.providers" or import a module providing it?',
      );
    }
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

  test("resolves an exported provider from a global module without explicit import", () => {
    const globalValue = createToken<string>("global-value");
    const globalMod = defineModule({
      id: "global-config",
      global: true,
      providers: [provideValue(globalValue, "from-global")],
      exports: [globalValue],
    });

    const consumer = defineModule({
      id: "consumer-without-import",
      imports: [], // does NOT import global-config
    });

    const root = defineModule({
      id: "root-app",
      imports: [globalMod, consumer],
    });

    const graph = compileModuleGraph(root);
    const resolved = graph.locate(consumer, globalValue);

    expect(resolved.module).toBe(globalMod);
    expect(resolved.provider.provide).toBe(globalValue);
    expect(createContainer(root).resolveModuleProvider(consumer, globalValue)).toBe("from-global");
  });

  test("local provider takes precedence over global module provider", () => {
    const sharedToken = createToken<string>("shared-token");
    const globalMod = defineModule({
      id: "global-override-source",
      global: true,
      providers: [provideValue(sharedToken, "global")],
      exports: [sharedToken],
    });

    const consumer = defineModule({
      id: "consumer-with-local",
      providers: [provideValue(sharedToken, "local")],
    });

    const root = defineModule({
      id: "root-app",
      imports: [globalMod, consumer],
    });

    const graph = compileModuleGraph(root);
    const resolved = graph.locate(consumer, sharedToken);

    expect(resolved.module).toBe(consumer);
    expect(createContainer(root).resolveModuleProvider(consumer, sharedToken)).toBe("local");
  });

  test("explicit import takes precedence over global module provider", () => {
    const sharedToken = createToken<string>("shared-token-2");
    const globalMod = defineModule({
      id: "global-source",
      global: true,
      providers: [provideValue(sharedToken, "from-global")],
      exports: [sharedToken],
    });

    const explicitMod = defineModule({
      id: "explicit-source",
      providers: [provideValue(sharedToken, "from-explicit")],
      exports: [sharedToken],
    });

    const consumer = defineModule({
      id: "consumer-with-explicit",
      imports: [explicitMod],
    });

    const root = defineModule({
      id: "root-app",
      imports: [globalMod, explicitMod, consumer],
    });

    const graph = compileModuleGraph(root);
    const resolved = graph.locate(consumer, sharedToken);

    expect(resolved.module).toBe(explicitMod);
    expect(createContainer(root).resolveModuleProvider(consumer, sharedToken)).toBe(
      "from-explicit",
    );
  });

  test("conflicting global modules exporting the same token trigger AMBIGUOUS_PROVIDER", () => {
    const conflictToken = createToken<string>("conflict-token");
    const globalA = defineModule({
      id: "global-a",
      global: true,
      providers: [provideValue(conflictToken, "a")],
      exports: [conflictToken],
    });

    const globalB = defineModule({
      id: "global-b",
      global: true,
      providers: [provideValue(conflictToken, "b")],
      exports: [conflictToken],
    });

    const consumer = defineModule({
      id: "consumer-conflict",
    });

    const root = defineModule({
      id: "root-app",
      imports: [globalA, globalB, consumer],
    });

    const graph = compileModuleGraph(root);

    expect(() => graph.locate(consumer, conflictToken)).toThrow(
      expect.objectContaining({
        code: "AMBIGUOUS_PROVIDER",
        details: expect.objectContaining({
          token: "conflict-token",
          candidates: expect.arrayContaining(["global-a", "global-b"]),
        }),
      }),
    );
  });

  test("provides actionable hint when a global module declares but does not export a provider", () => {
    const unexportedGlobalToken = createToken<string>("unexported-global-token");
    const globalMod = defineModule({
      id: "global-forgotten-export",
      global: true,
      providers: [provideValue(unexportedGlobalToken, "secret")],
      exports: [], // forgot to export
    });

    const consumer = defineModule({
      id: "consumer-for-forgotten",
    });

    const root = defineModule({
      id: "root-app",
      imports: [globalMod, consumer],
    });

    const graph = compileModuleGraph(root);

    try {
      graph.locate(consumer, unexportedGlobalToken);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error: any) {
      expect(error.code).toBe("MISSING_PROVIDER");
      expect(error.details.hints[0]).toContain(
        'Module "global-forgotten-export" is marked as global, but does not export "unexported-global-token". Add "unexported-global-token" to "global-forgotten-export.exports".',
      );
    }
  });
});
