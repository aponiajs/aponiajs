import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type ControllerDefinition,
  type ModuleDefinition,
} from "@aponiajs/common";
import { compileModuleGraph, createContainer } from "../src/index.ts";

describe("@aponiajs/core module graph", () => {
  test("compiles imports in deterministic dependency order", () => {
    const value = createToken<number>("value");
    const leaf = defineModule({
      id: "leaf",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const root = defineModule({ id: "root", imports: [leaf] });

    expect(compileModuleGraph(root).inspect()).toEqual({
      root: "root",
      modules: [
        {
          id: "leaf",
          imports: [],
          controllers: [],
          providers: ["value"],
          exports: ["value"],
        },
        {
          id: "root",
          imports: ["leaf"],
          controllers: [],
          providers: [],
          exports: [],
        },
      ],
    });
  });

  test("rejects module cycles", () => {
    const firstImports: ModuleDefinition[] = [];
    const first: ModuleDefinition = {
      id: "first",
      imports: firstImports,
      controllers: [],
      providers: [],
      exports: [],
    };
    const second: ModuleDefinition = {
      id: "second",
      imports: [first],
      controllers: [],
      providers: [],
      exports: [],
    };
    firstImports.push(second);

    expect(() => compileModuleGraph(first)).toThrow(AponiaError);
    try {
      compileModuleGraph(first);
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      expect((error as AponiaError).code).toBe("MODULE_CYCLE");
    }
  });

  test("rejects missing exports and ambiguous imports", () => {
    const value = createToken<number>("value");
    const invalid = defineModule({
      id: "invalid",
      exports: [value],
    });
    expect(() => compileModuleGraph(invalid)).toThrow(
      expect.objectContaining({ code: "INVALID_EXPORT" }),
    );

    const left = defineModule({
      id: "left",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const right = defineModule({
      id: "right",
      providers: [provideValue(value, 2)],
      exports: [value],
    });
    const result = createToken<number>("result");
    const root = defineModule({
      id: "ambiguous-root",
      imports: [left, right],
      providers: [provideFactory(result, [value] as const, (item) => item)],
    });
    expect(() => compileModuleGraph(root)).toThrow(
      expect.objectContaining({ code: "AMBIGUOUS_PROVIDER" }),
    );
  });

  test("rejects duplicate module identities", () => {
    const first = defineModule({ id: "duplicate" });
    const second = defineModule({ id: "duplicate" });
    const root = defineModule({
      id: "duplicate-root",
      imports: [first, second],
    });

    expect(() => compileModuleGraph(root)).toThrow(
      expect.objectContaining({
        code: "DUPLICATE_MODULE",
        details: { module: "duplicate" },
      }),
    );
  });

  test("allows configured modules with distinct instance identities", () => {
    const first = defineModule({
      id: "configured",
      instanceId: Symbol("first"),
    });
    const second = defineModule({
      id: "configured",
      instanceId: Symbol("second"),
    });
    const root = defineModule({
      id: "configured-root",
      imports: [first, second],
    });

    expect(compileModuleGraph(root).modules).toEqual([first, second, root]);
  });

  test("rejects duplicate provider and controller tokens", () => {
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
      expect.objectContaining({
        code: "DUPLICATE_PROVIDER",
        details: { module: "duplicate-providers", token: "duplicate-value" },
      }),
    );
    expect(() => compileModuleGraph(duplicateControllers)).toThrow(
      expect.objectContaining({
        code: "DUPLICATE_PROVIDER",
        details: { module: "duplicate-controllers", token: "DuplicateController" },
      }),
    );
  });

  test("rejects unresolvable provider and controller dependencies eagerly", () => {
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
      expect.objectContaining({
        code: "MISSING_PROVIDER",
        details: { module: "missing-provider-dependency", token: "missing" },
      }),
    );
    expect(() => compileModuleGraph(controllerModule)).toThrow(
      expect.objectContaining({
        code: "MISSING_PROVIDER",
        details: { module: "missing-controller-dependency", token: "missing" },
      }),
    );
  });

  test("deduplicates diamond exports by source module", () => {
    const value = createToken<number>("diamond-value");
    const source = defineModule({
      id: "diamond-source",
      providers: [provideValue(value, 1)],
      exports: [value],
    });
    const left = defineModule({
      id: "diamond-left",
      imports: [source],
      exports: [value],
    });
    const right = defineModule({
      id: "diamond-right",
      imports: [source],
      exports: [value],
    });
    const result = createToken<number>("diamond-result");
    const root = defineModule({
      id: "diamond-root",
      imports: [left, right],
      providers: [provideFactory(result, [value] as const, (item) => item)],
      exports: [result],
    });

    const graph = compileModuleGraph(root);

    expect(graph.locate(root, value).module).toBe(source);
    expect(createContainer(root).get(result)).toBe(1);
  });

  test("treats a shared provider descriptor in two modules as ambiguous", () => {
    const value = createToken<number>("shared-descriptor-value");
    const sharedProvider = provideValue(value, 1);
    const left = defineModule({
      id: "shared-descriptor-left",
      providers: [sharedProvider],
      exports: [value],
    });
    const right = defineModule({
      id: "shared-descriptor-right",
      providers: [sharedProvider],
      exports: [value],
    });
    const result = createToken<number>("shared-descriptor-result");
    const root = defineModule({
      id: "shared-descriptor-root",
      imports: [left, right],
      providers: [provideFactory(result, [value] as const, (item) => item)],
    });

    expect(() => compileModuleGraph(root)).toThrow(
      expect.objectContaining({ code: "AMBIGUOUS_PROVIDER" }),
    );
  });

  test("rejects lookups from outside the compiled graph", () => {
    const value = createToken<number>("outside-value");
    const root = defineModule({ id: "inside" });
    const outside = defineModule({ id: "outside" });
    const graph = compileModuleGraph(root);

    expect(() => graph.locate(outside, value)).toThrow(
      expect.objectContaining({
        code: "MISSING_PROVIDER",
        details: { module: "outside", token: "outside-value" },
      }),
    );
  });
});

describe("@aponiajs/core singleton container", () => {
  test("resolves value, factory, class, and alias providers across modules", () => {
    const prefix = createToken<string>("prefix");
    const label = createToken<string>("label");
    const publicGreeter = createToken<Greeter>("public-greeter");

    class Greeter {
      constructor(
        readonly prefixValue: string,
        readonly labelValue: string,
      ) {}

      greet(name: string): string {
        return `${this.prefixValue} ${name} from ${this.labelValue}`;
      }
    }

    const configuration = defineModule({
      id: "configuration",
      providers: [
        provideValue(prefix, "Hello"),
        provideFactory(label, [prefix] as const, (value) => `${value} Aponia`),
      ],
      exports: [prefix, label],
    });
    const feature = defineModule({
      id: "feature",
      imports: [configuration],
      providers: [
        provideClass(Greeter, [prefix, label] as const),
        provideAlias(publicGreeter, Greeter),
      ],
      exports: [publicGreeter],
    });
    const application = defineModule({
      id: "application",
      imports: [feature],
    });

    const container = createContainer(application);
    const first = container.get(publicGreeter);
    const second = container.get(publicGreeter);

    expect(first).toBe(second);
    expect(first.greet("Bun")).toBe("Hello Bun from Hello Aponia");
  });

  test("detects provider dependency cycles", () => {
    const first = createToken<string>("first");
    const second = createToken<string>("second");
    const module = defineModule({
      id: "cycle",
      providers: [
        provideFactory(first, [second] as const, (value) => value),
        provideFactory(second, [first] as const, (value) => value),
      ],
      exports: [first],
    });

    expect(() => createContainer(module).get(first)).toThrow(
      expect.objectContaining({ code: "PROVIDER_CYCLE" }),
    );
  });

  test("keeps non-exported imported providers outside root visibility", () => {
    const privateValue = createToken<number>("private-value");
    const feature = defineModule({
      id: "private-feature",
      providers: [provideValue(privateValue, 42)],
    });
    const root = defineModule({
      id: "private-root",
      imports: [feature],
    });
    const container = createContainer(root);

    expect(() => container.get(privateValue)).toThrow(
      expect.objectContaining({ code: "MISSING_PROVIDER" }),
    );
    expect(container.resolveModuleProvider(feature, privateValue)).toBe(42);
  });

  test("keeps shared provider and controller definitions local to each module", () => {
    const localValue = createToken<string>("local-value");
    const result = createToken<{ readonly value: string }>("result");
    const sharedProvider = provideFactory(result, [localValue] as const, (value) => ({
      value,
    }));

    class SharedController {
      constructor(readonly resultValue: { readonly value: string }) {}
    }

    const sharedController: ControllerDefinition = {
      kind: "test",
      token: SharedController,
      inject: [result],
      useClass: SharedController as never,
    };
    const left = defineModule({
      id: "left-local",
      providers: [provideValue(localValue, "left"), sharedProvider],
      controllers: [sharedController],
    });
    const right = defineModule({
      id: "right-local",
      providers: [provideValue(localValue, "right"), sharedProvider],
      controllers: [sharedController],
    });
    const root = defineModule({
      id: "shared-definitions-root",
      imports: [left, right],
    });

    const container = createContainer(root);
    expect(container.resolveModuleProvider(left, localValue)).toBe("left");
    expect(container.resolveModuleProvider(right, localValue)).toBe("right");
    const leftController = container.instantiateController<SharedController>(
      left,
      sharedController,
    );
    const rightController = container.instantiateController<SharedController>(
      right,
      sharedController,
    );

    expect(leftController).not.toBe(rightController);
    expect(leftController.resultValue).not.toBe(rightController.resultValue);
    expect(leftController.resultValue.value).toBe("left");
    expect(rightController.resultValue.value).toBe("right");
  });
});
