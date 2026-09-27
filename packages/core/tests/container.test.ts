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
} from "@aponiajs/common";
import { createContainer } from "../src/index.ts";

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
        details: { module: "spi-feature", token: "root-only" },
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
});
