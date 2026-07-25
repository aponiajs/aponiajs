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
});
