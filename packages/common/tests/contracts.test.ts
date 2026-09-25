import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  ConsoleLogger,
  Controller,
  Inject,
  Module,
  createToken,
  defineModule,
  getConstructorDependencies,
  getControllerMetadata,
  getModuleMetadata,
  provideFactory,
  provideValue,
  tokenName,
  type ClassToken,
} from "../src/index.ts";
import type { RouteResponseSettings } from "../src/index.ts";

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The response settings contract. `redirect` is asserted absent on purpose: the
 * supported platform ignores an assigned redirect, so the type must not offer
 * one.
 */
type ResponseSettingsAssertions = [
  Expect<Equals<"redirect" extends keyof RouteResponseSettings ? true : false, false>>,
  Expect<Equals<RouteResponseSettings["status"], number | string | undefined>>,
  Expect<
    Equals<RouteResponseSettings["headers"], Record<string, string | number | string[] | undefined>>
  >,
];

describe("@aponiajs/common", () => {
  test("creates typed identity tokens", () => {
    const first = createToken<number>("count");
    const second = createToken<number>("count");

    expect(first).not.toBe(second);
    expect(tokenName(first)).toBe("count");
  });

  test("creates immutable module and provider descriptors", () => {
    const count = createToken<number>("count");
    const doubled = createToken<number>("doubled");
    const module = defineModule({
      id: "values",
      providers: [
        provideValue(count, 2),
        provideFactory(doubled, [count] as const, (value) => value * 2),
      ],
      exports: [doubled],
    });

    expect(Object.isFrozen(module)).toBe(true);
    expect(Object.isFrozen(module.providers)).toBe(true);
    expect(module.providers).toHaveLength(2);
  });

  test("normalizes omitted module collections without widening declared tuples", () => {
    const emptyModule = defineModule({ id: "empty" });
    const first = defineModule({ id: "first" });
    const second = defineModule({ id: "second" });
    const root = defineModule({
      id: "root",
      imports: [first, second],
    });
    const exactImports: readonly [typeof first, typeof second] = root.imports;
    const exactEmptyImports: readonly [] = emptyModule.imports;

    expect(exactImports).toEqual([first, second]);
    expect(exactEmptyImports).toEqual([]);
    expect(Object.isFrozen(emptyModule.imports)).toBe(true);
  });

  test("uses cascading Nest-style log levels", () => {
    const logger = new ConsoleLogger({
      colors: false,
      logLevels: ["warn"],
    });

    expect(logger.isLevelEnabled("fatal")).toBe(true);
    expect(logger.isLevelEnabled("error")).toBe(true);
    expect(logger.isLevelEnabled("warn")).toBe(true);
    expect(logger.isLevelEnabled("log")).toBe(false);
  });

  test("combines reflected constructor types with explicit injection tokens", () => {
    class ReflectedDependency {}
    class Consumer {}
    const explicitDependency = createToken<string>("explicit-dependency");
    Reflect.defineMetadata(
      "design:paramtypes",
      [ReflectedDependency, ReflectedDependency],
      Consumer,
    );
    Inject(explicitDependency)(Consumer, undefined, 1);

    expect(getConstructorDependencies(Consumer)).toEqual([ReflectedDependency, explicitDependency]);
    expect(Object.isFrozen(getConstructorDependencies(Consumer))).toBe(true);
  });

  test("resolves a parent's explicit injection tokens on a constructor-less subclass", () => {
    class ParentConsumer {
      constructor(_dependency: string) {}
    }
    class ChildConsumer extends ParentConsumer {}
    const explicitDependency = createToken<string>("inherited-dependency");
    Reflect.defineMetadata("design:paramtypes", [String], ParentConsumer);
    Inject(explicitDependency)(ParentConsumer, undefined, 0);

    expect(getConstructorDependencies(ParentConsumer)).toEqual([explicitDependency]);
    expect(getConstructorDependencies(ChildConsumer)).toEqual([explicitDependency]);
    expect(Object.isFrozen(getConstructorDependencies(ChildConsumer))).toBe(true);
  });

  test("keeps a subclass's own injection tokens when it declares a constructor", () => {
    class ParentConsumer {
      constructor(_dependency: string) {}
    }
    class ChildConsumer extends ParentConsumer {
      constructor(_dependency: string) {
        super(_dependency);
      }
    }
    const parentDependency = createToken<string>("parent-dependency");
    const childDependency = createToken<string>("child-dependency");
    Reflect.defineMetadata("design:paramtypes", [String], ParentConsumer);
    Inject(parentDependency)(ParentConsumer, undefined, 0);
    Reflect.defineMetadata("design:paramtypes", [String], ChildConsumer);
    Inject(childDependency)(ChildConsumer, undefined, 0);

    expect(getConstructorDependencies(ChildConsumer)).toEqual([childDependency]);
  });

  test("keeps inherited constructor dependencies when a subclass declares a bare constructor", () => {
    class ReflectedDependency {}
    class ParentConsumer {
      constructor(_dependency: ReflectedDependency) {}
    }
    class ChildConsumer extends ParentConsumer {
      constructor(_dependency: ReflectedDependency) {
        super(_dependency);
      }
    }
    Reflect.defineMetadata("design:paramtypes", [ReflectedDependency], ParentConsumer);

    expect(getConstructorDependencies(ChildConsumer)).toEqual([ReflectedDependency]);
  });

  test("carries explicit injection tokens through a deep subclass chain", () => {
    class ChainRoot {
      constructor(_dependency: string) {}
    }
    class ChainMiddle extends ChainRoot {}
    class ChainLeaf extends ChainMiddle {}
    const chainDependency = createToken<string>("chain-dependency");
    Reflect.defineMetadata("design:paramtypes", [String], ChainRoot);
    Inject(chainDependency)(ChainRoot, undefined, 0);

    expect(getConstructorDependencies(ChainMiddle)).toEqual([chainDependency]);
    expect(getConstructorDependencies(ChainLeaf)).toEqual([chainDependency]);
  });

  test("shadows the inherited token map whole when a subclass declares its own tokens", () => {
    class OverridingParent {
      constructor(_first: string, _second: string) {}
    }
    class OverridingChild extends OverridingParent {
      constructor(_first: string, _second: string) {
        super(_first, _second);
      }
    }
    const firstDependency = createToken<string>("first-dependency");
    const secondDependency = createToken<string>("second-dependency");
    const childDependency = createToken<string>("child-dependency");
    Reflect.defineMetadata("design:paramtypes", [String, String], OverridingParent);
    Inject(firstDependency)(OverridingParent, undefined, 0);
    Inject(secondDependency)(OverridingParent, undefined, 1);
    Reflect.defineMetadata("design:paramtypes", [String, String], OverridingChild);
    Inject(childDependency)(OverridingChild, undefined, 0);

    // Own metadata wins wholesale, exactly as `design:paramtypes` already does,
    // so a re-declared index 0 does not leave the parent's index 1 behind. A
    // per-index merge would silently inject a token the subclass moved away
    // from.
    expect(getConstructorDependencies(OverridingChild)).toEqual([childDependency, String]);
  });

  test("keeps the response settings writable without advertising a redirect field", () => {
    const settings: RouteResponseSettings = { headers: {} };
    settings.status = 201;
    settings.headers["x-source"] = "settings";
    settings.headers["retry-after"] = 30;
    const assertions = Array.from({ length: 3 }, () => true) as ResponseSettingsAssertions;

    expect(settings.status).toBe(201);
    expect(settings.headers).toEqual({ "x-source": "settings", "retry-after": 30 });
    expect(assertions).toHaveLength(3);
  });

  test("rejects constructor metadata that cannot become an injection token", () => {
    class InvalidConsumer {}
    Reflect.defineMetadata("design:paramtypes", [undefined], InvalidConsumer);

    expect(() => getConstructorDependencies(InvalidConsumer)).toThrow(
      'Cannot resolve a constructor dependency for "InvalidConsumer". Use @Inject(token) for non-class tokens.',
    );
  });

  test("keeps module and controller metadata owned by the decorated class", () => {
    class ParentModule {}
    class ChildModule extends ParentModule {}
    class ParentController {}
    class ChildController extends ParentController {}
    Module({})(ParentModule);
    Controller("parent")(ParentController);

    expect(getModuleMetadata(ParentModule)).toBeDefined();
    expect(getModuleMetadata(ChildModule)).toBeUndefined();
    expect(getControllerMetadata(ParentController)?.path).toBe("parent");
    expect(getControllerMetadata(ChildController)).toBeUndefined();
  });

  test("creates frozen tokens with unique symbol identities", () => {
    const first = createToken<number>("count");
    const second = createToken<number>("count");

    expect(Object.isFrozen(first)).toBe(true);
    expect(typeof first.id).toBe("symbol");
    expect(first.description).toBe("count");
    expect(first.id).not.toBe(second.id);
  });

  test("names class tokens and falls back for anonymous classes", () => {
    class NamedDependency {}

    expect(tokenName(NamedDependency)).toBe("NamedDependency");
    expect(tokenName(createAnonymousClass())).toBe("<anonymous class>");
  });

  test("copies and freezes structured error details", () => {
    const details: Record<string, string> = { token: "value" };
    const error = new AponiaError("MISSING_PROVIDER", "Cannot resolve the token.", details);
    details.token = "changed";

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AponiaError");
    expect(error.code).toBe("MISSING_PROVIDER");
    expect(error.details).toEqual({ token: "value" });
    expect(Object.isFrozen(error.details)).toBe(true);

    const withoutDetails = new AponiaError("INVALID_MODULE", "Invalid module.");

    expect(withoutDetails.details).toEqual({});
    expect(Object.isFrozen(withoutDetails.details)).toBe(true);
  });
});

function createAnonymousClass(): ClassToken<unknown> {
  return class {};
}

test("shares decorator metadata across separate common package instances", async () => {
  type DecoratorsModule = typeof import("../src/decorators/decorators.ts");

  const decoratorsUrl = new URL("../src/decorators/decorators.ts", import.meta.url);
  const first = (await import(`${decoratorsUrl.href}?instance=first`)) as DecoratorsModule;
  const second = (await import(`${decoratorsUrl.href}?instance=second`)) as DecoratorsModule;

  class SharedModule {}
  class SharedController {
    handle(): string {
      return "ok";
    }
  }
  class SharedDependency {}
  class SharedConsumer {}

  first.Module({ controllers: [SharedController] })(SharedModule);
  first.Controller("shared")(SharedController);
  first.Get("health")(
    SharedController.prototype,
    "handle",
    Object.getOwnPropertyDescriptor(SharedController.prototype, "handle")!,
  );
  first.Inject(SharedDependency)(SharedConsumer, undefined, 0);

  expect(second.getModuleMetadata(SharedModule)?.controllers).toEqual([SharedController]);
  expect(second.getControllerMetadata(SharedController)?.path).toBe("shared");
  expect(second.getRouteMetadata(SharedController)).toEqual([
    {
      method: "GET",
      path: "health",
      propertyKey: "handle",
      schema: undefined,
    },
  ]);
  expect(second.getConstructorDependencies(SharedConsumer)).toEqual([SharedDependency]);
});
