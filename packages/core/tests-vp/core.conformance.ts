import {
  createToken,
  defineModule,
  forwardRef,
  provideClass,
  provideFactory,
  provideValue,
  Scope,
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

test("the Vite+ lane resolves a class bound to a separate token", () => {
  const greeting = createToken<string>("bound-conformance-greeting");
  const repository = createToken<Repository>("bound-conformance-repository");

  class Repository {
    constructor(readonly greeting: string) {}

    read(): string {
      return this.greeting;
    }
  }
  class SqlRepository extends Repository {}

  const module = defineModule({
    id: "bound-conformance",
    providers: [
      provideValue(greeting, "Hello"),
      provideClass(repository, SqlRepository, [greeting] as const),
    ],
    exports: [repository],
  });

  const container = createContainer(module);
  const bound = container.get(repository);

  expect(bound).toBeInstanceOf(SqlRepository);
  expect(bound.read()).toBe("Hello");
  expect(() => container.get(SqlRepository)).toThrow(
    expect.objectContaining({ code: "MISSING_PROVIDER" }),
  );
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

test("the Vite+ lane keeps one instance per exported provider and root visibility", () => {
  const shared = createToken<{ readonly value: string }>("conformance-shared");
  const privateValue = createToken<number>("conformance-private");
  const feature = defineModule({
    id: "conformance-feature",
    providers: [provideValue(privateValue, 1)],
  });
  const root = defineModule({
    id: "conformance-root",
    imports: [feature],
    providers: [provideValue(shared, { value: "shared" })],
  });
  const container = createContainer(root);
  const resolved: { readonly value: string } = container.get(shared);

  expect(container.get(shared)).toBe(resolved);
  expect(container.resolveModuleProvider(feature, privateValue)).toBe(1);
  expect(() => container.get(privateValue)).toThrow(
    expect.objectContaining({
      code: "MISSING_PROVIDER",
      details: expect.objectContaining({
        module: "conformance-root",
        token: "conformance-private",
      }),
    }),
  );
});

test("the Vite+ lane instantiates transient providers on each resolution and refuses invalid scopes", () => {
  const transientToken = createToken<{ id: number }>("conformance-transient");
  let count = 0;
  const unsupportedToken = createToken<number>("conformance-unsupported");

  const module = defineModule({
    id: "conformance-scope",
    providers: [
      provideFactory(transientToken, [], () => ({ id: ++count }), { scope: Scope.TRANSIENT }),
      provideValue(unsupportedToken, 1, { scope: "invalid-scope" as any }),
    ],
  });

  const container = createContainer(module);
  const a = container.get(transientToken);
  const b = container.get(transientToken);
  expect(a).not.toBe(b);
  expect(a.id).toBe(1);
  expect(b.id).toBe(2);

  expect(() => container.get(unsupportedToken)).toThrow(
    expect.objectContaining({
      code: "UNSUPPORTED_PROVIDER_SCOPE",
      details: { token: "conformance-unsupported", scope: "invalid-scope" },
    }),
  );
});

test("the Vite+ lane resolves a predefined provider as fallback", () => {
  const predefinedToken = createToken<string>("conformance-predefined");
  const module = defineModule({
    id: "conformance-predefined-root",
  });
  const container = createContainer(module, [
    provideValue(predefinedToken, "conformance-fallback"),
  ]);
  expect(container.get(predefinedToken)).toBe("conformance-fallback");
});

test("the Vite+ lane resolves an exported provider from a global module without importing it", () => {
  const globalToken = createToken<string>("conformance-global-token");
  const globalModule = defineModule({
    id: "conformance-global-module",
    global: true,
    providers: [provideValue(globalToken, "conformance-global-value")],
    exports: [globalToken],
  });
  const consumerModule = defineModule({
    id: "conformance-consumer-module",
  });
  const rootModule = defineModule({
    id: "conformance-root-app",
    imports: [globalModule, consumerModule],
  });

  const container = createContainer(rootModule);
  expect(container.resolveModuleProvider(consumerModule, globalToken)).toBe(
    "conformance-global-value",
  );
});

test("the Vite+ lane resolves circular provider dependencies using forwardRef", () => {
  const tokenA = createToken<ServiceA>("conformance-service-a");
  const tokenB = createToken<ServiceB>("conformance-service-b");

  class ServiceA {
    constructor(readonly b: ServiceB) {}
    name() {
      return "ServiceA";
    }
    callB() {
      return this.b.name();
    }
  }

  class ServiceB {
    constructor(readonly a: ServiceA) {}
    name() {
      return "ServiceB";
    }
    callA() {
      return this.a.name();
    }
  }

  const module = defineModule({
    id: "conformance-circular",
    providers: [
      provideClass(tokenA, ServiceA, [forwardRef(() => tokenB)]),
      provideClass(tokenB, ServiceB, [forwardRef(() => tokenA)]),
    ],
    exports: [tokenA, tokenB],
  });

  const container = createContainer(module);
  const a = container.get(tokenA);
  const b = container.get(tokenB);

  expect(a.callB()).toBe("ServiceB");
  expect(b.callA()).toBe("ServiceA");
});
