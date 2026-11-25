import { expect, test } from "bun:test";
import {
  APP_GUARD,
  createToken,
  defineModule,
  provideClass,
  provideValue,
  type CanActivate,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import {
  collectApplicationEnhancerEntries,
  collectLifecycleCalls,
  resolveApplicationGuards,
} from "./index.ts";

class FirstGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

class SecondGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

test("application enhancer entries keep module order and declaration order", () => {
  const inner = defineModule({
    id: "inner",
    providers: [
      provideClass(FirstGuard, []),
      provideClass(SecondGuard, []),
      provideValue(APP_GUARD, FirstGuard),
      provideValue(APP_GUARD, [SecondGuard]),
    ],
  });
  const root = defineModule({ id: "root", imports: [inner] });
  const container = createContainer(root);

  const entries = collectApplicationEnhancerEntries<CanActivate>(container, APP_GUARD);
  expect(entries.map((entry) => (entry.entry as { name: string }).name)).toEqual([
    "FirstGuard",
    "SecondGuard",
  ]);

  const guards = resolveApplicationGuards(container);
  expect(guards).toHaveLength(2);
  expect(guards[0]).toBeInstanceOf(FirstGuard);
  expect(guards[1]).toBeInstanceOf(SecondGuard);
});

test("lifecycle modules run deepest first and reverse the module order on shutdown", async () => {
  const order: string[] = [];
  class DeepestModule {
    onModuleInit(): void {
      order.push("deepest");
    }
  }
  class MiddleModule {
    onModuleInit(): void {
      order.push("middle");
    }
  }
  class RootModule {
    onModuleInit(): void {
      order.push("root");
    }
  }
  const deepest = defineModule({ id: "deepest", moduleClass: DeepestModule });
  const middle = defineModule({ id: "middle", moduleClass: MiddleModule, imports: [deepest] });
  const root = defineModule({ id: "root", moduleClass: RootModule, imports: [middle] });
  const container = createContainer(root);

  for (const call of collectLifecycleCalls(container, "onModuleInit")) {
    await call();
  }
  expect(order).toEqual(["deepest", "middle", "root"]);

  order.length = 0;
  for (const call of collectLifecycleCalls(container, "onModuleInit", {
    reverseModules: true,
  })) {
    await call();
  }
  expect(order).toEqual(["root", "middle", "deepest"]);
});

test("Modules with no provider still contribute their own class hook", async () => {
  const calls: string[] = [];
  class RootModule {
    onModuleInit(): void {
      calls.push("root");
    }
  }
  const module = defineModule({ id: "root-module", moduleClass: RootModule });
  const container = createContainer(module);

  for (const call of collectLifecycleCalls(container, "onModuleInit")) {
    await call();
  }
  expect(calls).toEqual(["root"]);
});

test("an unknown token has no application enhancers", () => {
  const root = defineModule({ id: "empty" });
  const container = createContainer(root);
  expect(resolveApplicationGuards(container)).toEqual([]);
  expect(collectApplicationEnhancerEntries(container, createToken("none"))).toEqual([]);
});
