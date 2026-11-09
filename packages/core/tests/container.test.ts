import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  ModuleRef,
  createToken,
  defineModule,
  forwardRef,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  optionalDependency,
  type ControllerDefinition,
  type ModuleDefinition,
} from "@aponiajs/common";
import { compileModuleGraph, createContainer } from "../src/index.ts";

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

describe("@aponiajs/core container edges", () => {
  test("eagerly instantiates module providers once and reuses the cached instance", () => {
    let calls = 0;
    const value = createToken<{ readonly calls: number }>("eager-value");
    const module = defineModule({
      id: "eager",
      providers: [
        provideFactory(value, [] as const, () => {
          calls += 1;
          return { calls };
        }),
      ],
      exports: [value],
    });

    const container = createContainer(module);

    expect(calls).toBe(0);

    container.initializeModule(module);

    expect(calls).toBe(1);
    expect(container.get(value)).toEqual({ calls: 1 });
    expect(calls).toBe(1);
  });

  test("detects a provider that depends on itself", () => {
    const self = createToken<string>("self");
    const module = defineModule({
      id: "self-cycle",
      providers: [provideFactory(self, [self] as const, (value) => value)],
      exports: [self],
    });

    const error = captureAponiaError(() => createContainer(module).get(self));

    expect(error.code).toBe("PROVIDER_CYCLE");
    expect(error.details).toEqual({ cycle: ["self-cycle:self", "self-cycle:self"] });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  test("detects an alias that points at its own token", () => {
    const alias = createToken<string>("alias");
    const module = defineModule({
      id: "alias-cycle",
      providers: [provideAlias(alias, alias)],
    });

    const error = captureAponiaError(() => createContainer(module).get(alias));

    expect(error.code).toBe("PROVIDER_CYCLE");
    expect(error.details).toEqual({ cycle: ["alias-cycle:alias", "alias-cycle:alias"] });
  });

  test("reports the full resolution path for an indirect provider cycle", () => {
    const first = createToken<string>("first");
    const second = createToken<string>("second");
    const third = createToken<string>("third");
    const module = defineModule({
      id: "indirect",
      providers: [
        provideFactory(first, [second] as const, (value) => value),
        provideFactory(second, [third] as const, (value) => value),
        provideFactory(third, [first] as const, (value) => value),
      ],
      exports: [first],
    });

    const error = captureAponiaError(() => createContainer(module).get(first));

    expect(error.code).toBe("PROVIDER_CYCLE");
    expect(error.details).toEqual({
      cycle: ["indirect:first", "indirect:second", "indirect:third", "indirect:first"],
    });
  });

  test("constructs a controller once and injects the shared provider instance", () => {
    let constructed = 0;
    const dependency = createToken<{ readonly value: string }>("controller-dependency");
    const dependencyInstance = Object.freeze({ value: "injected" });
    const dependencyModule = defineModule({
      id: "controller-dependency-module",
      providers: [provideValue(dependency, dependencyInstance)],
      exports: [dependency],
    });

    class Consumer {
      constructor(readonly dependency: { readonly value: string }) {
        constructed += 1;
      }
    }

    const controller: ControllerDefinition = {
      kind: "test",
      token: Consumer,
      inject: [dependency],
      useClass: Consumer as never,
    };
    const root = defineModule({
      id: "controller-root",
      imports: [dependencyModule],
      controllers: [controller],
    });

    const container = createContainer(root);
    const first = container.instantiateController<Consumer>(root, controller);
    const second = container.instantiateController<Consumer>(root, controller);

    expect(constructed).toBe(1);
    expect(second).toBe(first);
    expect(first.dependency).toBe(dependencyInstance);
    expect(first.dependency).toBe(container.get(dependency));
  });

  test("resolves an alias chain to the instance of the aliased class provider", () => {
    class Greeter {
      greet(): string {
        return "hello";
      }
    }

    const firstAlias = createToken<Greeter>("first-alias");
    const secondAlias = createToken<Greeter>("second-alias");
    const feature = defineModule({
      id: "alias-feature",
      providers: [provideClass(Greeter, [] as const)],
      exports: [Greeter],
    });
    const root = defineModule({
      id: "alias-root",
      imports: [feature],
      providers: [provideAlias(firstAlias, Greeter), provideAlias(secondAlias, firstAlias)],
    });

    const container = createContainer(root);

    expect(container.get(secondAlias)).toBe(container.get(firstAlias));
    expect(container.get(secondAlias)).toBe(container.get(Greeter));
    expect(container.get(secondAlias).greet()).toBe("hello");
  });

  test("resolves inside an arbitrary module without falling back to root visibility", () => {
    const rootOnly = createToken<number>("root-only");
    const feature = defineModule({ id: "spi-feature" });
    const root = defineModule({
      id: "spi-root",
      imports: [feature],
      providers: [provideValue(rootOnly, 7)],
    });

    const container = createContainer(root);

    expect(container.get(rootOnly)).toBe(7);
    expect(() => container.resolveModuleProvider(feature, rootOnly)).toThrow(
      expect.objectContaining({
        code: "MISSING_PROVIDER",
        details: expect.objectContaining({ module: "spi-feature", token: "root-only" }),
      }),
    );
  });

  test("shares one instance of an exported provider across importing modules", () => {
    let calls = 0;
    const shared = createToken<{ readonly value: string }>("shared-instance");
    const derived = createToken<{ readonly value: string }>("derived-instance");
    const sharedModule = defineModule({
      id: "shared-provider-module",
      providers: [
        provideFactory(shared, [] as const, () => {
          calls += 1;
          return { value: "shared" };
        }),
      ],
      exports: [shared],
    });
    const feature = defineModule({
      id: "shared-consumer-module",
      imports: [sharedModule],
      providers: [provideFactory(derived, [shared] as const, (instance) => instance)],
    });
    const root = defineModule({ id: "shared-root", imports: [sharedModule, feature] });

    const container = createContainer(root);
    container.initializeModule(feature);

    expect(calls).toBe(1);
    expect(container.resolveModuleProvider(feature, derived)).toBe(container.get(shared));

    container.initializeModule(sharedModule);
    container.initializeModule(feature);

    expect(calls).toBe(1);
    expect(container.get(shared).value).toBe("shared");
  });

  test("resolves circular provider dependencies when declared with forwardRef", () => {
    const serviceAToken = createToken<ServiceA>("service-a");
    const serviceBToken = createToken<ServiceB>("service-b");

    class ServiceA {
      constructor(readonly b: ServiceB) {}

      getName(): string {
        return "ServiceA";
      }

      callB(): string {
        return `A calls ${this.b.getName()}`;
      }
    }

    class ServiceB {
      constructor(readonly a: ServiceA) {}

      getName(): string {
        return "ServiceB";
      }

      callA(): string {
        return `B calls ${this.a.getName()}`;
      }
    }

    const module = defineModule({
      id: "circular-providers",
      providers: [
        provideClass(serviceAToken, ServiceA, [forwardRef(() => serviceBToken)]),
        provideClass(serviceBToken, ServiceB, [forwardRef(() => serviceAToken)]),
      ],
      exports: [serviceAToken, serviceBToken],
    });

    const container = createContainer(module);
    const a = container.get(serviceAToken);
    const b = container.get(serviceBToken);

    expect(a).toBeInstanceOf(ServiceA);
    expect(b).toBeInstanceOf(ServiceB);
    expect(a.callB()).toBe("A calls ServiceB");
    expect(b.callA()).toBe("B calls ServiceA");
  });

  test("compiles circular module imports when declared with forwardRef", () => {
    const tokenA = createToken<string>("token-a");
    const tokenB = createToken<string>("token-b");

    let moduleB: ModuleDefinition;

    const moduleA = defineModule({
      id: "module-a",
      imports: [forwardRef(() => moduleB)],
      providers: [provideValue(tokenA, "value-a")],
      exports: [tokenA],
    });

    moduleB = defineModule({
      id: "module-b",
      imports: [forwardRef(() => moduleA)],
      providers: [provideValue(tokenB, "value-b")],
      exports: [tokenB],
    });

    const root = defineModule({
      id: "circular-root",
      imports: [moduleA, moduleB],
    });

    const graph = compileModuleGraph(root);
    expect(graph.locate(moduleA, tokenB).module).toBe(moduleB);
    expect(graph.locate(moduleB, tokenA).module).toBe(moduleA);

    const container = createContainer(root);
    expect(container.resolveModuleProvider(moduleA, tokenB)).toBe("value-b");
    expect(container.resolveModuleProvider(moduleB, tokenA)).toBe("value-a");
  });

  test("resolves an optional dependency that is absent to undefined", () => {
    const missing = createToken<string>("missing-optional");
    const consumer = createToken<string>("optional-consumer");
    const module = defineModule({
      id: "optional-missing",
      providers: [
        provideFactory(consumer, [optionalDependency(missing)] as const, (value) =>
          value === undefined ? "absent" : value,
        ),
      ],
    });

    expect(createContainer(module).get(consumer)).toBe("absent");
  });

  test("resolves an optional dependency that is visible to its value", () => {
    const present = createToken<string>("present-optional");
    const consumer = createToken<string>("optional-present-consumer");
    const module = defineModule({
      id: "optional-present",
      providers: [
        provideValue(present, "visible"),
        provideFactory(consumer, [optionalDependency(present)] as const, (value) => value),
      ],
    });

    expect(createContainer(module).get(consumer)).toBe("visible");
  });

  test("keeps an ambiguous optional dependency a failure", () => {
    const ambiguous = createToken<string>("ambiguous-optional");
    const left = defineModule({
      id: "ambiguous-left",
      providers: [provideValue(ambiguous, "left")],
      exports: [ambiguous],
    });
    const right = defineModule({
      id: "ambiguous-right",
      providers: [provideValue(ambiguous, "right")],
      exports: [ambiguous],
    });
    const root = defineModule({
      id: "ambiguous-root",
      imports: [left, right],
      providers: [
        provideFactory(
          createToken<string>("ambiguous-consumer"),
          [optionalDependency(ambiguous)] as const,
          (value) => value,
        ),
      ],
    });

    const error = captureAponiaError(() => createContainer(root));

    expect(error.code).toBe("AMBIGUOUS_PROVIDER");
  });

  test("makes ModuleRef resolve a provider that is local to the receiving module", () => {
    const local = createToken<string>("module-ref-local");
    const observed = createToken<string>("module-ref-observed");
    const feature = defineModule({
      id: "module-ref-feature",
      providers: [
        provideValue(local, "local-value"),
        provideFactory(observed, [ModuleRef] as const, (ref) => ref.get(local)),
      ],
    });
    const root = defineModule({ id: "module-ref-root", imports: [feature] });
    const container = createContainer(root);

    expect(container.resolveModuleProvider(feature, observed)).toBe("local-value");
    expect(container.resolveModuleProvider(feature, ModuleRef).get(local)).toBe("local-value");
  });

  test("keeps ModuleRef lookups scoped to the module that received it", () => {
    const privateToken = createToken<string>("module-ref-private");
    const feature = defineModule({
      id: "module-ref-private-feature",
      providers: [provideValue(privateToken, "private")],
    });
    const root = defineModule({ id: "module-ref-private-root", imports: [feature] });
    const container = createContainer(root);

    expect(() => container.get(ModuleRef).get(privateToken)).toThrow(
      expect.objectContaining({ code: "MISSING_PROVIDER" }),
    );
    expect(container.resolveModuleProvider(feature, ModuleRef).get(privateToken)).toBe("private");
  });

  test("forwards membership, assignment, and prototype reads to a circular dependency", () => {
    class ServiceA {
      label = "service-a";

      constructor(readonly b: ServiceB) {}

      describe(): string {
        return this.label;
      }
    }

    class ServiceB {
      constructor(readonly a: ServiceA) {}
    }

    const serviceAToken = createToken<ServiceA>("trap-service-a");
    const serviceBToken = createToken<ServiceB>("trap-service-b");
    const module = defineModule({
      id: "circular-trap-providers",
      providers: [
        provideClass(serviceAToken, ServiceA, [forwardRef(() => serviceBToken)]),
        provideClass(serviceBToken, ServiceB, [forwardRef(() => serviceAToken)]),
      ],
    });

    const container = createContainer(module);
    const proxy = container.get(serviceAToken).b.a;

    expect("describe" in proxy).toBe(true);
    proxy.label = "changed";
    expect(proxy.label).toBe("changed");
    expect(proxy.describe()).toBe("changed");
    expect(Object.getPrototypeOf(proxy)).toBe(ServiceA.prototype);
  });

  test("lets ModuleRef resolve a provider through the module that received it", () => {
    const local = createToken<string>("module-ref-resolve-local");
    const observed = createToken<string>("module-ref-resolve-observed");
    const feature = defineModule({
      id: "module-ref-resolve-feature",
      providers: [
        provideValue(local, "resolved-value"),
        provideFactory(observed, [ModuleRef] as const, (ref) => ref.resolve(local)),
      ],
    });
    const root = defineModule({ id: "module-ref-resolve-root", imports: [feature] });

    expect(createContainer(root).resolveModuleProvider(feature, observed)).toBe("resolved-value");
  });
});
