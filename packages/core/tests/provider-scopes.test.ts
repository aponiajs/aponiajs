import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
} from "@aponiajs/common";
import { AponiaContainer, compileModuleGraph, createContainer } from "../src/index.ts";

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

/**
 * The lifetimes a declaration can state before the container honors them.
 *
 * Only `"singleton"` is instantiated today. `"request"` and `"transient"`
 * are reserved so a declaration states the lifetime it needs up front, and
 * resolving one fails with `UNSUPPORTED_PROVIDER_SCOPE` rather than silently
 * serving a singleton where a fresh instance was promised. These cases pin
 * the reservation; the per-request and per-resolution instantiation they
 * refuse is later work, not this change.
 */
describe("reserved provider scopes", () => {
  test("boots providers that declare nothing and providers that declare singleton", () => {
    const plain = createToken<number>("scope.plain");
    const single = createToken<number>("scope.singleton");
    const container = createContainer(
      defineModule({
        id: "app",
        providers: [provideValue(plain, 1), provideValue(single, 2, { scope: "singleton" })],
      }),
    );

    expect(container.get(plain)).toBe(1);
    expect(container.get(single)).toBe(2);
  });

  test("freezes the declared scope onto the provider", () => {
    const provider = provideValue(createToken<number>("scope.frozen"), 1, { scope: "request" });

    expect(provider.scope).toBe("request");
    expect(Object.isFrozen(provider)).toBe(true);
  });

  test("refuses a value provider that declares a scope this release does not instantiate", () => {
    const provider = provideValue(createToken<number>("scope.value"), 1, { scope: "request" });
    const module = defineModule({ id: "app", providers: [provider] });

    const eager = captureAponiaError(() => {
      new AponiaContainer(compileModuleGraph(module)).initializeModule(module);
    });
    expect(eager.code).toBe("UNSUPPORTED_PROVIDER_SCOPE");
    expect(eager.details).toMatchObject({ scope: "request" });
    expect(Object.isFrozen(eager.details)).toBe(true);

    const lazy = captureAponiaError(() => createContainer(module).get(provider.provide));
    expect(lazy.code).toBe("UNSUPPORTED_PROVIDER_SCOPE");
    expect(lazy.details).toMatchObject({ token: "scope.value", scope: "request" });
  });

  test("refuses a factory provider that declares a scope this release does not instantiate", () => {
    const provider = provideFactory(createToken<number>("scope.factory"), [], () => 1, {
      scope: "transient",
    });
    const module = defineModule({ id: "app", providers: [provider] });

    expect(captureAponiaError(() => createContainer(module).get(provider.provide)).code).toBe(
      "UNSUPPORTED_PROVIDER_SCOPE",
    );
  });

  test("refuses a class provider that declares a scope this release does not instantiate", () => {
    class Scoped {}
    const provider = provideClass(Scoped, [], { scope: "request" });
    const module = defineModule({ id: "app", providers: [provider] });

    expect(captureAponiaError(() => createContainer(module).get(provider.provide)).code).toBe(
      "UNSUPPORTED_PROVIDER_SCOPE",
    );
  });

  test("refuses a scoped alias through the same code while its target still resolves", () => {
    const target = createToken<number>("scope.target");
    const alias = provideAlias(createToken<number>("scope.alias"), target, { scope: "request" });
    const module = defineModule({
      id: "app",
      providers: [provideValue(target, 1), alias],
    });

    const container = createContainer(module);
    expect(container.get(target)).toBe(1);
    expect(captureAponiaError(() => container.get(alias.provide)).code).toBe(
      "UNSUPPORTED_PROVIDER_SCOPE",
    );
  });

  test("never serves a scoped provider from the singleton store on a second read", () => {
    const provider = provideValue(createToken<number>("scope.unstored"), 1, { scope: "request" });
    const container = createContainer(defineModule({ id: "app", providers: [provider] }));

    expect(captureAponiaError(() => container.get(provider.provide)).code).toBe(
      "UNSUPPORTED_PROVIDER_SCOPE",
    );
    expect(captureAponiaError(() => container.get(provider.provide)).code).toBe(
      "UNSUPPORTED_PROVIDER_SCOPE",
    );
  });
});
