# Lifecycle seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider can run code once its module is initialized, once the whole graph is up, and while the application is stopping — on both authoring paths, with no decorator, no metadata, and no descriptor change.

**Architecture:** The hooks are five type-only contracts in `@aponiajs/common` and a structural read of the provider instance in `@aponiajs/platform-elysia`. The read is the mechanism the codebase already uses for an interceptor's halves (`enhancer-resolver.ts:174-175`), which is what makes the hand-written descriptor path work for free: the instance carries the method, so nothing in the descriptor, the artifacts built from it, or inspection changes. The boot owns the timing — it is the only thing that knows the order — and the shutdown plan reaches `close()` through the same non-enumerable symbol seam the boot record already uses, so `AponiaElysiaApplication`'s public constructor does not change.

**Tech Stack:** TypeScript (strict, ESM, `#private`), Bun test, Vite+ conformance, Elysia 1.4.30.

**Spec:** `docs/superpowers/specs/2026-09-28-aponia-lifecycle-seam-design.md`

## What the spec leaves to this plan, settled before Task 1

1. **No hook takes a parameter.** Nest's `beforeApplicationShutdown(signal?: string)` carries a
   shutdown signal; here there is none to carry, because an application stops when `close()` is
   called rather than when a signal arrives, and inventing a signal the platform never produces
   would be a parameter that is always `undefined`. All five signatures are `(): void |
Promise<void>`. A class written for Nest with a signal parameter stays assignable, because a
   function with fewer parameters satisfies one with more.
2. **The spec's "Once" for the two application-level shutdown hooks means one moment, not one
   call.** Every hooked instance's method runs at that moment, in graph order with a module's
   providers before its controllers — the order `onModuleInit` uses, which the spec fixes for the
   init side and leaves open here.
3. **This seam adds a fourth failure-reporting call site**, and
   `packages/platform-elysia/AGENTS.md` enumerates three. The guide is edited in Task 3, because
   that enumeration is an invariant the repository maintains rather than prose.
4. **The spec's `onModuleInit` row said "before any gateway is compiled", and that is not
   satisfiable.** `compileElysiaWebSocketGateways` runs near the top of `bootstrapAponiaApplication`,
   ahead of the provider pass, so no placement that follows the controller pass can precede it. The
   row now says "before the gateway pass", which is what the hook does precede: gateway instances
   bound, their routes mounted, and their `afterInit` run. The spec and Task 4's table are corrected
   together, because Task 4's page is where the sentence was going to be published.
5. **The shutdown plan rides a symbol, not a constructor parameter.**
   `bootstrapAponiaApplication` already attaches its record under
   `Symbol.for("aponia.application.diagnostics")` with a non-enumerable, non-writable property so
   Elysia's own composition never walks it. The shutdown plan is attached the same way, which is
   what keeps `AponiaElysiaApplication`'s public constructor unchanged and lets a plain `Elysia`
   an application built itself keep behaving exactly as it does today.

## Global Constraints

- Every file, comment, and document is English. Before finishing a task:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- **Branch `feature/lifecycle-seam`, from `release/alpha`.** Do not push, and do not bump the
  version: a push to a release branch publishes every package, and the bump belongs to the push.
- **`@aponiajs/common` gains types and no runtime.** The five contracts are interfaces with no
  implementation; nothing in that package calls them, and nothing there may learn what a hook is
  for. The reading and the calling live in `@aponiajs/platform-elysia`.
- **`@aponiajs/core` gains nothing.** The container keeps resolving providers; `initializeModule`
  does not learn about hooks, and no new concept enters that package.
- **No descriptor, metadata, artifact, or inspection change.** The mechanism is the instance, so
  `Provider`, `ControllerDefinition`, the invoker and descriptor artifacts, and
  `inspectAponiaApplication` are all untouched. A task that finds it needs one of them has found
  a design error and must report it rather than extend one.
- **The hook names are exactly Nest's five**: `onModuleInit`, `onApplicationBootstrap`,
  `onModuleDestroy`, `beforeApplicationShutdown`, `onApplicationShutdown`, and the interfaces
  `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `BeforeApplicationShutdown`,
  `OnApplicationShutdown`. No synonyms.
- **A hook that throws while the application is starting fails the boot, and the thrown value
  propagates unchanged.** It is never wrapped in an `AponiaError`, and `AponiaErrorCode` gains no
  member: the closed union describes what the framework detects, and an application's own failure
  is not one of those.
- **A hook that throws while the application is stopping is reported and the rest still run**, and
  the server still stops. `close()` may not become a call that cannot complete.
- **`close()` runs the shutdown hooks even when the application never listened**, because every
  test lane in this repository drives an application through `handle` and closes it.
- Gates before each task's commit: `bun run check` plus the lanes that task names. Whole-branch
  verification, after Task 5, runs `bun run check`, `bun run test:coverage`,
  `bun run test:vite-plus`, `bun run test:examples`, `bun run release:dry-run` (published contents
  change — the barrel gains exports), then `bun run build` followed by
  `bun run test:generated-app`. After any `bun run build`, delete the declarations it leaves beside
  sources before a test lane: `find packages -name '*.d.ts' -path '*/src/*' -delete`.
- `scripts/source-layout.spec.ts` asserts an exact owner-directory list per package, so
  `packages/common/src/lifecycle` must be added to it in the same change that creates it.
  `packages/platform-elysia/src/application` already exists, so the platform files add no entry.
- The example's port is **3090** — 3000 through 3080 are taken — and `bun install` must register it
  in `bun.lock`, or the frozen install CI runs fails before any test does.
- Markdown tables are formatter-owned: run `bun run check --fix`, then re-verify. A passing
  `bun test` does not prove a document is formatter-clean.
- Commit bodies explain why the change is right and end with
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

Six input classes the spec implies and no task's prose would otherwise cover. Each line's test is
in the task named beside it.

1. **A hook that throws while the application is stopping, when other hooks still have to run.**
   A reasonable person expects the remaining shutdown work to happen and the server to stop
   anyway, and expects to find the failure in the logs rather than in a `close()` that rejects.
   (Task 3)
2. **`close()` on an application that never listened.** Every test lane does exactly this, so a
   shutdown hook that only ran after `listen` would be unreachable in tests and wrong in
   production for an application that booted and stopped. (Task 3)
3. **A hook written as a class-field arrow function.** It is an own property of the instance and
   of no token, which is the exact reason the interceptor halves are read from the instance; a
   read that only looked at a prototype would silently skip it. (Task 2)
4. **A `provideValue` whose value carries a hook-shaped method.** The mechanism is structural, so
   such a value is called. The test pins that consequence rather than leaving it to be discovered.
   (Task 2)
5. **A hook that throws during `onModuleInit`.** The boot fails with the application's own value
   unchanged, and a later module's hook does not run — the failure is not swallowed into a boot
   that looks successful. (Task 2)
6. **One object reached through more than one provider entry.** An alias resolves to its target, and
   a provider a module exports is the same instance its importers resolve, so a hook called once per
   entry would open one pool twice or start one timer twice for one object. The hooks are a fact
   about the instance. (Task 2)
7. **An asynchronous hook, and the hook that follows it.** Every case in the first draft of the
   suite was synchronous, which means a boot that dropped its `await` would have passed all of them:
   the order a later hook observes is the only assertion that can fail. (Task 2 for the starting
   half, Task 3 for the stopping half.)

---

### Task 1: The contracts

**Files:**

- Create: `packages/common/src/lifecycle/lifecycle.types.ts`
- Modify: `packages/common/src/index.ts` (the barrel)
- Modify: `packages/common/AGENTS.md` (the domain table gains the new directory)
- Modify: `scripts/source-layout.spec.ts` (the `packages/common/src` directory list)
- Modify: `packages/common/llms.txt`
- Create: `packages/platform-elysia/tests-vp/lifecycle.conformance.ts` (the compile-time half only;
  Tasks 2 and 3 add the runtime cases to the same file)
- Test: `packages/platform-elysia/tests-vp/lifecycle.conformance.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`,
  `BeforeApplicationShutdown`, and `OnApplicationShutdown`, each declaring one method returning
  `void | Promise<void>`, all exported from `@aponiajs/common`'s barrel.

- [ ] **Step 1: Write the failing test**

`packages/platform-elysia/tests-vp/lifecycle.conformance.ts`:

```ts
import {
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@aponiajs/common";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

/**
 * The five contracts, each satisfied by a synchronous method and by one that
 * returns a promise. A contract that stopped accepting either would fail
 * `bun run check` here rather than in an application.
 */
class SyncHooks
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  onModuleInit(): void {}
  onApplicationBootstrap(): void {}
  onModuleDestroy(): void {}
  beforeApplicationShutdown(): void {}
  onApplicationShutdown(): void {}
}

class AsyncHooks
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  async onModuleInit(): Promise<void> {}
  async onApplicationBootstrap(): Promise<void> {}
  async onModuleDestroy(): Promise<void> {}
  async beforeApplicationShutdown(): Promise<void> {}
  async onApplicationShutdown(): Promise<void> {}
}

test("a synchronous hook answers nothing and an asynchronous one answers a promise", () => {
  const sync = new SyncHooks();
  const asynchronous = new AsyncHooks();

  // Compiling is the whole assertion: a class that stopped satisfying a contract
  // fails `bun run check`. These calls exercise the two local doubles, and they
  // cannot fail on a contract change at runtime.
  expect(sync.onModuleInit()).toBeUndefined();
  expect(sync.onApplicationBootstrap()).toBeUndefined();
  expect(sync.onModuleDestroy()).toBeUndefined();
  expect(sync.beforeApplicationShutdown()).toBeUndefined();
  expect(sync.onApplicationShutdown()).toBeUndefined();
  expect(asynchronous.onModuleInit()).toBeInstanceOf(Promise);
  expect(asynchronous.onApplicationShutdown()).toBeInstanceOf(Promise);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run check`
Expected: FAIL — five `TS2305` errors, one per missing contract (`Module '"@aponiajs/common"' has
no exported member 'OnModuleInit'`, and so on). **The compile error is the red, not the lane's test
run**: the Vite+ lane strips types without checking them, so `bunx vp test` on this file passes even
while nothing it imports exists. Every compile-time half in Tasks 2 and 3 is red under
`bun run check` for the same reason; their runtime cases are the ones `bun test` and `vp test` fail.

- [ ] **Step 3: Write the contracts**

`packages/common/src/lifecycle/lifecycle.types.ts`:

```ts
/**
 * The five moments an application can hook, in the order a boot reaches them.
 *
 * A hook is a method on a provider instance, and the platform reads it from
 * there rather than from metadata or a descriptor field — the same way an
 * interceptor's halves are read — so a class registered by a hand-written
 * descriptor carries them with no declaration of its own. These interfaces
 * exist so a class can say `implements OnModuleInit` and be told when a
 * signature drifts, exactly as they do in Nest.
 *
 * Nothing in this package calls them: `@aponiajs/common` states the contract,
 * and the platform owns the timing.
 */

/** Runs once its module's providers and controllers exist. */
export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

/** Runs once, after every module is initialized and every route and gateway is mounted. */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): void | Promise<void>;
}

/** Runs while the application is stopping, before the server stops. */
export interface BeforeApplicationShutdown {
  beforeApplicationShutdown(): void | Promise<void>;
}

/** Runs while the application is stopping, after the server has stopped. */
export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}

/** Runs last, once the application has stopped. */
export interface OnApplicationShutdown {
  onApplicationShutdown(): void | Promise<void>;
}
```

In `packages/common/src/index.ts`, beside the other type-only re-exports:

```ts
export type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "./lifecycle/lifecycle.types.ts";
```

- [ ] **Step 4: Register the directory in the guard and in the guide**

In `scripts/source-layout.spec.ts`, add `"lifecycle"` to the `packages/common/src` directory list,
between `"errors"` and `"logging"`. The list is asserted exactly, so a new directory that is not
added here fails the suite.

In `packages/common/AGENTS.md`, add a row to the "What this package owns" domain table:

```markdown
| `lifecycle/` | The five type-only provider lifecycle contracts |
```

`scripts/AGENTS.md` states the invariant this closes — "Update the guide and guard together when a
real new source domain is introduced" — and no guard reads that table, so a guide left behind stays
behind.

- [ ] **Step 5: Run the test and the guards**

Run: `bunx vp test packages/platform-elysia/tests-vp/lifecycle.conformance.ts`
Expected: 1 pass.

Run: `bun test scripts/source-layout.spec.ts`
Expected: pass.

- [ ] **Step 6: Advertise the contracts and commit**

In `packages/common/llms.txt`, add to the public types list:

```markdown
- [OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown, OnModuleDestroy, OnApplicationShutdown](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/common/src/lifecycle/lifecycle.types.ts): the five moments a provider can hook, in the order a boot reaches them, read from the instance by the platform.
```

```bash
bun run check --fix
bun test packages/common scripts/
bunx vp test packages/platform-elysia/tests-vp/lifecycle.conformance.ts
git add packages/common packages/platform-elysia/tests-vp/lifecycle.conformance.ts scripts/source-layout.spec.ts
git commit -m "feat(common): state the five lifecycle moments as contracts"
```

---

### Task 2: The boot calls the starting hooks

**Files:**

- Create: `packages/platform-elysia/src/application/lifecycle-hooks.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts` (the controller pass
  and the gateway pass)
- Create: `packages/platform-elysia/tests/lifecycle.test.ts`
- Modify: `packages/platform-elysia/tests-vp/lifecycle.conformance.ts` (a runtime case)
- Test: `packages/platform-elysia/tests/lifecycle.test.ts`

**Interfaces:**

- Consumes: the five contracts from Task 1.
- Produces: `lifecycleCallable(instance, name)` and the `LifecycleCall` type from
  `application/lifecycle-hooks.ts`. Task 3 adds the shutdown-plan seam to the same file, so every
  export this task writes is called by the code this task writes.

Two of this task's cases — the class-field arrow and the `provideClass` registrations — are also
the descriptor-parity evidence the spec asks for: neither declares a hook through a decorator, and
neither would work if the reading came from metadata. A gateway is a class provider, so it carries
these hooks through the same loop, and no case here pins that separately.

- [ ] **Step 1: Write the failing test**

`packages/platform-elysia/tests/lifecycle.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  createToken,
  provideAlias,
  provideClass,
  provideValue,
  type LoggerService,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "../src/index.ts";

const calls: string[] = [];

@Injectable()
class Dependency implements OnModuleInit {
  onModuleInit(): void {
    calls.push("dependency:init");
  }
}

@Injectable()
class Dependent implements OnModuleInit, OnApplicationBootstrap {
  constructor(readonly dependency: Dependency) {}

  onModuleInit(): void {
    calls.push("dependent:init");
  }

  onApplicationBootstrap(): void {
    calls.push("dependent:bootstrap");
  }
}

@Controller("lifecycle")
class LifecycleController implements OnModuleInit {
  onModuleInit(): void {
    calls.push("controller:init");
  }

  @Get()
  read(): string {
    return "ok";
  }
}

@Module({ providers: [Dependency, Dependent], controllers: [LifecycleController] })
class AppModule {}

let application: AponiaElysiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
  calls.length = 0;
});

describe("the starting hooks", () => {
  test("run dependencies first, then the module, and bootstrap once after the routes mount", async () => {
    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(calls).toEqual([
      "dependency:init",
      "dependent:init",
      "controller:init",
      "dependent:bootstrap",
    ]);
  });

  test("a route answers after the hooks have run", async () => {
    application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/lifecycle"));

    expect(response.status).toBe(200);
    expect(calls).toContain("dependent:bootstrap");
  });

  test("awaits an asynchronous hook before the next one runs", async () => {
    calls.length = 0;

    class Slow implements OnModuleInit {
      async onModuleInit(): Promise<void> {
        await Bun.sleep(1);
        calls.push("slow:init");
      }
    }

    class Fast implements OnModuleInit {
      onModuleInit(): void {
        calls.push("fast:init");
      }
    }

    @Module({ providers: [provideClass(Slow, []), provideClass(Fast, [])] })
    class SlowModule {}

    application = await AponiaFactory.create(SlowModule, { logger: false });

    // The order is the whole assertion: a boot that stopped awaiting would push
    // `fast:init` first, and every other case in this file is synchronous, so
    // nothing else here can fail if the await is dropped.
    expect(calls).toEqual(["slow:init", "fast:init"]);
  });

  test("runs a controller's onApplicationBootstrap too", async () => {
    calls.length = 0;

    @Controller("bootstrap")
    class BootstrappingController implements OnApplicationBootstrap {
      onApplicationBootstrap(): void {
        calls.push("controller:bootstrap");
      }

      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({ controllers: [BootstrappingController] })
    class BootstrappingModule {}

    application = await AponiaFactory.create(BootstrappingModule, { logger: false });

    expect(calls).toEqual(["controller:bootstrap"]);
  });
});

describe("the order across modules", () => {
  test("runs an imported module's hook before its importer's", async () => {
    calls.length = 0;

    class Inner implements OnModuleInit {
      onModuleInit(): void {
        calls.push("inner:init");
      }
    }

    class Outer implements OnModuleInit {
      constructor(readonly inner: Inner) {}

      onModuleInit(): void {
        calls.push("outer:init");
      }
    }

    @Module({ providers: [Inner], exports: [Inner] })
    class InnerModule {}

    @Module({ imports: [InnerModule], providers: [Outer] })
    class OuterModule {}

    application = await AponiaFactory.create(OuterModule, { logger: false });

    expect(calls).toEqual(["inner:init", "outer:init"]);
  });
});

describe("the reading", () => {
  test("calls a hook written as a class field, which lives on the instance", async () => {
    calls.length = 0;

    class FieldHooked {
      // An own property of the instance, not of the prototype: the reason the
      // interceptor halves are read from the instance, and the reason this is.
      onModuleInit = () => {
        calls.push("field:init");
      };
    }

    @Module({ providers: [provideClass(FieldHooked, [])] })
    class FieldModule {}

    application = await AponiaFactory.create(FieldModule, { logger: false });

    expect(calls).toEqual(["field:init"]);
  });

  test("calls a hook-shaped method on a value, because the reading is structural", async () => {
    calls.length = 0;
    const value = {
      onModuleInit(): void {
        calls.push("value:init");
      },
    };
    const token = createToken<typeof value>("LIFECYCLE_VALUE");

    @Module({ providers: [provideValue(token, value)] })
    class ValueModule {}

    application = await AponiaFactory.create(ValueModule, { logger: false });

    expect(calls).toEqual(["value:init"]);
  });

  test("calls one instance's hook once, however many entries reach it", async () => {
    calls.length = 0;

    class Shared {
      onModuleInit(): void {
        calls.push("shared:init");
      }
    }
    const alias = createToken<Shared>("SHARED_ALIAS");

    // Two entries, one object: an alias resolves to its target, so a hook that
    // ran per entry would open this instance's pool twice.
    @Module({ providers: [provideClass(Shared, []), provideAlias(alias, Shared)] })
    class SharedModule {}

    application = await AponiaFactory.create(SharedModule, { logger: false });

    expect(calls).toEqual(["shared:init"]);
  });

  test("ignores a value that cannot carry a method", async () => {
    calls.length = 0;
    const nothing = createToken<null>("NOTHING");

    // `null` is the input the reader's early return exists for: a number reads a
    // missing property harmlessly, while a null instance throws on the read
    // itself, so this case fails if the guard is dropped and a number's would not.
    @Module({ providers: [provideValue(nothing, null)] })
    class NullModule {}

    application = await AponiaFactory.create(NullModule, { logger: false });

    expect(calls).toEqual([]);
  });
});

describe("a hook that throws while starting", () => {
  test("fails the boot with the thrown value unchanged and runs no later hook", async () => {
    calls.length = 0;
    const failure = new Error("init refused");

    class Refusing implements OnModuleInit {
      onModuleInit(): void {
        calls.push("refusing:init");
        throw failure;
      }
    }

    class After implements OnModuleInit {
      onModuleInit(): void {
        calls.push("after:init");
      }
    }

    @Module({ providers: [provideClass(Refusing, []), provideClass(After, [])] })
    class RefusingModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(RefusingModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failure);
    expect(calls).toEqual(["refusing:init"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/lifecycle.test.ts`
Expected: FAIL — the first case's `calls` is empty, so no hook ran.

- [ ] **Step 3: Write the reader**

`packages/platform-elysia/src/application/lifecycle-hooks.ts`:

```ts
import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { isElysiaController } from "../controllers/controller-definition.ts";

/** The contract a hook name belongs to, for the type of the collected callables. */
export type LifecycleHookContract =
  | OnModuleInit
  | OnApplicationBootstrap
  | OnModuleDestroy
  | BeforeApplicationShutdown
  | OnApplicationShutdown;

/** One callable per hooked instance, already bound. */
export type LifecycleCall = () => void | Promise<void>;

/**
 * The member names the five contracts contribute, gathered member by member.
 *
 * `keyof` a union is the intersection of its members' keys, and no two of the
 * five contracts share a member name, so `keyof LifecycleHookContract` alone is
 * `never`. Distributing over the union is what yields the five names, and it
 * keeps them derived from the contracts rather than restated beside them, so a
 * renamed or removed contract member fails `bun run check` at every call site.
 */
type LifecycleHookName<T> = T extends unknown ? keyof T : never;

/**
 * The hook an instance declares, if it declares one.
 *
 * The check is the instance's own, which is the mechanism this package already
 * uses for an interceptor's halves: a method written as a class field is an own
 * property of the instance and of no token, so reading it anywhere else would
 * skip the declaration. Binding here rather than at the call site keeps a
 * prototype method's `this` correct and leaves a class field's own arrow
 * function unchanged.
 */
export function lifecycleCallable(
  instance: unknown,
  name: LifecycleHookName<LifecycleHookContract>,
): LifecycleCall | undefined {
  if (typeof instance !== "object" || instance === null) {
    return undefined;
  }

  const candidate = (instance as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as LifecycleCall).bind(instance) : undefined;
}

/**
 * Every hook the graph declares for one moment, in the order a boot reaches
 * them: modules in graph order — post-order, so a module that imports another
 * comes first — and within a module its providers in declaration order, then
 * its controllers.
 *
 * **Once per instance, not once per entry.** One object can be reached through
 * more than one entry: an alias resolves to its target, and a provider a module
 * exports is the same instance its importers resolve. Walking entries alone
 * would call one object's hook once per entry, which is a pool opened twice and
 * a timer started twice for one object — the hooks are a fact about the
 * instance, and this is what makes them one.
 */
export function collectLifecycleCalls(
  container: AponiaContainer,
  name: LifecycleHookName<LifecycleHookContract>,
): LifecycleCall[] {
  const calls: LifecycleCall[] = [];
  const collected = new Set<unknown>();

  const collect = (instance: unknown): void => {
    if (collected.has(instance)) {
      return;
    }
    collected.add(instance);

    const call = lifecycleCallable(instance, name);
    if (call) {
      calls.push(call);
    }
  };

  for (const module of container.graph.modules) {
    for (const provider of module.providers) {
      collect(container.resolveModuleProvider(module, provider.provide));
    }
    for (const controller of module.controllers) {
      if (isElysiaController(controller)) {
        collect(container.instantiateController(module, controller));
      }
    }
  }

  return calls;
}
```

Task 3 adds the shutdown-plan seam to this same file, so every export this task writes is called by
the code this task writes: nothing here is dead until the next task.

- [ ] **Step 4: Call the starting hooks from the boot**

In `packages/platform-elysia/src/application/application-bootstrap.ts`, after the controller pass
ends and before `attachApplicationDiagnostics(...)` is called, insert:

```ts
// The graph is instantiated — providers in the first pass, controllers in the
// second — and the modules now initialize in the order `graph.modules` already
// holds them, which is post-order, so a module that imports another runs after
// it. The hooks do not interleave with instantiation: every module's providers
// and controllers exist before the first hook runs, so what this orders is
// modules rather than isolating one.
for (const call of collectLifecycleCalls(container, "onModuleInit")) {
  await call();
}
```

and after `await nativeApplication.modules;` at the end of the gateway work — the last statement
before the wrapper is returned — insert:

```ts
// Once, after every route and gateway is mounted and no further plugin work is
// pending: a hook that needs the whole graph — a scheduler, a migration check,
// a cache warm — has one place to stand, and it is before anything can listen.
for (const call of collectLifecycleCalls(container, "onApplicationBootstrap")) {
  await call();
}
```

Add `collectLifecycleCalls` to the file's imports from `./lifecycle-hooks.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/platform-elysia/tests/lifecycle.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 6: Mirror the behaviour in the conformance lane**

This case has a runtime red — `bun test` on the platform suite — and its compile-time half is red
under `bun run check`, which is where the lane's own `vp test` would not catch a type error.

Add to `packages/platform-elysia/tests-vp/lifecycle.conformance.ts`:

```ts
test("runs a provider's onModuleInit through a real boot", async () => {
  const calls: string[] = [];

  class Hooked {
    onModuleInit(): void {
      calls.push("init");
    }
  }

  @Module({ providers: [provideClass(Hooked, [])] })
  class HookedModule {}

  const application = await AponiaFactory.create(HookedModule, { logger: false });
  try {
    expect(calls).toEqual(["init"]);
  } finally {
    await application.close();
  }
});
```

with `Controller`, `Module`, `AponiaFactory`, and `provideClass` imported at the top of the file.

- [ ] **Step 7: Run the gates and commit**

```bash
bun run check --fix
bun test packages/platform-elysia/tests/lifecycle.test.ts
bun run --filter @aponiajs/platform-elysia test
bunx vp test packages/platform-elysia/tests-vp/lifecycle.conformance.ts
git add packages/platform-elysia
git commit -m "feat(platform-elysia): initialize a module through the hook its instance declares"
```

---

### Task 3: The stopping hooks

**Files:**

- Modify: `packages/platform-elysia/src/application/lifecycle-hooks.ts` (the plan seam)
- Modify: `packages/common/src/logging/logger.types.ts` (the guarded-site rule gains this call site)
- Modify: `docs/logging.md` (the same rule, in the published prose)
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts` (attach the plan)
- Modify: `packages/platform-elysia/src/application/aponia-elysia-application.ts` (`close()`)
- Modify: `packages/platform-elysia/AGENTS.md` (the enumerated failure-reporting call sites)
- Modify: `packages/platform-elysia/tests/lifecycle.test.ts`
- Modify: `packages/platform-elysia/tests-vp/lifecycle.conformance.ts`
- Test: `packages/platform-elysia/tests/lifecycle.test.ts`

**Interfaces:**

- Consumes: `lifecycleCallable`, `attachApplicationShutdown`, `readApplicationShutdown`, and
  `ApplicationShutdown` from Task 2.
- Produces: `close()` runs `beforeApplicationShutdown`, stops the server, runs `onModuleDestroy` in
  reverse module order, then runs `onApplicationShutdown`.

- [ ] **Step 1: Write the failing test**

Append to `packages/platform-elysia/tests/lifecycle.test.ts`, beside the file's own `calls` array:

```ts
describe("the stopping hooks", () => {
  test("run in the documented order around the server stopping", async () => {
    calls.length = 0;
    // A hook receives no context, so the phase it runs in is only observable
    // through the application the case closed over: `server` is null once
    // `stop` has run. Asking the server itself is what pins the stop's place,
    // and both boundaries are checked so a stop that moved either way shows.
    const stoppedWhenCalled: boolean[] = [];

    class Stopping implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown {
      // Both are asynchronous on purpose: the sequence below is what fails if the
      // runner stops awaiting between hooks, and one async hook could only prove
      // the first boundary.
      async beforeApplicationShutdown(): Promise<void> {
        await Bun.sleep(1);
        calls.push("before");
        stoppedWhenCalled.push(application.getNativeApplication().server === null);
      }

      async onModuleDestroy(): Promise<void> {
        await Bun.sleep(1);
        calls.push("destroy");
        stoppedWhenCalled.push(application.getNativeApplication().server === null);
      }

      onApplicationShutdown(): void {
        calls.push("shutdown");
      }
    }

    @Module({ providers: [provideClass(Stopping, [])] })
    class StoppingModule {}

    application = await AponiaFactory.create(StoppingModule, { logger: false });
    await application.listen(0);
    await application.close();

    expect(calls).toEqual(["before", "destroy", "shutdown"]);
    expect(application.getNativeApplication().server).toBeNull();
    // The server was up when the first hook ran and gone when the second did.
    // A stop moved before `beforeApplicationShutdown` leaves `[true, true]`, one
    // moved after `onModuleDestroy` leaves `[false, false]`, and a deleted stop
    // leaves `[false, false]` too.
    expect(stoppedWhenCalled).toEqual([false, true]);
  });

  test("run on an application that never listened", async () => {
    calls.length = 0;

    class NeverListening implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("shutdown");
      }
    }

    @Module({ providers: [provideClass(NeverListening, [])] })
    class NeverListeningModule {}

    application = await AponiaFactory.create(NeverListeningModule, { logger: false });
    await application.close();

    expect(calls).toEqual(["shutdown"]);
  });

  test("run a module's destroy after the module that depends on it", async () => {
    calls.length = 0;

    class Inner implements OnModuleDestroy {
      onModuleDestroy(): void {
        calls.push("inner");
      }
    }

    class Outer implements OnModuleDestroy {
      constructor(readonly inner: Inner) {}

      onModuleDestroy(): void {
        calls.push("outer");
      }
    }

    @Module({ providers: [Inner], exports: [Inner] })
    class InnerModule {}

    @Module({ imports: [InnerModule], providers: [Outer] })
    class OuterModule {}

    application = await AponiaFactory.create(OuterModule, { logger: false });
    await application.close();

    expect(calls).toEqual(["outer", "inner"]);
  });

  test("report a throwing hook, stop the server anyway, and run the rest", async () => {
    calls.length = 0;
    const reported: string[] = [];
    const failure = new Error("could not close the pool");

    class RecordingLogger implements LoggerService {
      log(): void {}
      warn(): void {}
      debug(): void {}
      verbose(): void {}
      fatal(): void {}

      error(message: unknown): void {
        reported.push(String(message));
      }
    }

    // The throw is in the *first* stopping phase and the proof is in the last:
    // a throw placed in the final phase could not show that a failure there
    // still lets the server stop and the remaining phases run.
    class Refusing implements BeforeApplicationShutdown {
      beforeApplicationShutdown(): void {
        calls.push("refusing");
        throw failure;
      }
    }

    class After implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("after");
      }
    }

    @Module({ providers: [provideClass(Refusing, []), provideClass(After, [])] })
    class RefusingModule {}

    application = await AponiaFactory.create(RefusingModule, { logger: new RecordingLogger() });
    await application.listen(0);
    await application.close();

    expect(calls).toEqual(["refusing", "after"]);
    expect(reported.join("\n")).toContain("could not close the pool");
    expect(application.getNativeApplication().server).toBeNull();
  });

  test("run the stopping hooks once, however many times close is called", async () => {
    calls.length = 0;

    class Once implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("shutdown");
      }
    }

    @Module({ providers: [provideClass(Once, [])] })
    class OnceModule {}

    application = await AponiaFactory.create(OnceModule, { logger: false });
    await application.close();
    await application.close();

    // The pre-seam `close()` was a no-op once the server had stopped, and a
    // teardown hook run twice is a pool closed twice: the plan runs at most once.
    expect(calls).toEqual(["shutdown"]);
  });

  test("join a close already in flight instead of resolving before it finishes", async () => {
    calls.length = 0;

    class Slow implements OnApplicationShutdown {
      async onApplicationShutdown(): Promise<void> {
        await Bun.sleep(5);
        calls.push("shutdown");
      }
    }

    @Module({ providers: [provideClass(Slow, [])] })
    class SlowModule {}

    application = await AponiaFactory.create(SlowModule, { logger: false });
    await application.listen(0);

    await Promise.all([application.close(), application.close()]);

    // Both callers waited for the same teardown: a second call that returned
    // early would resolve while the first was still running, telling a caller an
    // application is down that is not.
    expect(calls).toEqual(["shutdown"]);
    expect(application.getNativeApplication().server).toBeNull();
  });

  test("stop a server that was bound after an earlier close", async () => {
    calls.length = 0;

    class Late implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("shutdown");
      }
    }

    @Module({ providers: [provideClass(Late, [])] })
    class LateModule {}

    application = await AponiaFactory.create(LateModule, { logger: false });
    await application.close();
    await application.listen(0);
    await application.close();

    // A `close()` before the application listened must not make a later one a
    // no-op: the listener would outlive the call that was meant to end it.
    expect(application.getNativeApplication().server).toBeNull();
    expect(calls).toEqual(["shutdown"]);
  });

  test("carry on when the logger itself throws while reporting", async () => {
    calls.length = 0;

    class ThrowingLogger implements LoggerService {
      log(): void {}
      warn(): void {}
      debug(): void {}
      verbose(): void {}
      fatal(): void {}

      error(): void {
        throw new Error("the logger refused");
      }
    }

    class Refusing implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("refusing");
        throw new Error("could not close the pool");
      }
    }

    class After implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("after");
      }
    }

    @Module({ providers: [provideClass(Refusing, []), provideClass(After, [])] })
    class ThrowingLoggerModule {}

    application = await AponiaFactory.create(ThrowingLoggerModule, {
      logger: new ThrowingLogger(),
    });

    await application.close();

    // The guard is the whole point of the seam this reports through: a logger
    // that refuses while reporting must not cost the remaining hooks their turn,
    // and `close()` must still resolve.
    expect(calls).toEqual(["refusing", "after"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/lifecycle.test.ts`
Expected: FAIL — `calls` is empty for every stopping case.

- [ ] **Step 3: Add the plan seam to the reader, then build and attach the plan**

Append to `packages/platform-elysia/src/application/lifecycle-hooks.ts`:

```ts
/** The plan a boot attaches for `close()`: the shutdown half, in order. */
export type ApplicationShutdown = (closeActiveConnections?: boolean) => Promise<void>;

const lifecycleKey: unique symbol = Symbol.for("aponia.application.lifecycle");

/**
 * Attaches the shutdown plan to the native application it belongs to.
 *
 * The property is non-enumerable, non-writable, and non-configurable for the
 * same reason the boot record's is: Elysia composes by walking an instance's
 * keys, and an application no boot produced must read as `undefined` rather
 * than as an empty plan. Rides a symbol rather than a constructor parameter so
 * `AponiaElysiaApplication`'s public signature does not change.
 */
export function attachApplicationShutdown(
  application: AponiaNativeApplication<unknown>,
  shutdown: ApplicationShutdown,
): void {
  Object.defineProperty(application, lifecycleKey, {
    value: shutdown,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/** The shutdown plan a boot attached, or `undefined` for an application no boot produced. */
export function readApplicationShutdown(application: unknown): ApplicationShutdown | undefined {
  return (application as { [lifecycleKey]?: ApplicationShutdown } | null | undefined)?.[
    lifecycleKey
  ];
}
```

Then, in `packages/platform-elysia/src/application/application-bootstrap.ts`, after the starting hooks of
Task 2 and before `attachApplicationDiagnostics(...)`, insert:

```ts
// The shutdown plan is collected once, while the container holds every
// instance, and handed to the wrapper through the symbol seam below. Reading
// it here rather than from the container later means `close()` needs no
// container: an application the boot did not produce reads as `undefined` and
// keeps the behaviour it has today.
const beforeShutdown = collectLifecycleCalls(container, "beforeApplicationShutdown");
const moduleDestroy = [...collectLifecycleCalls(container, "onModuleDestroy")].reverse();
const applicationShutdown = collectLifecycleCalls(container, "onApplicationShutdown");

// Each group of stopping hooks runs once per boot, and a second caller joins the
// group already running rather than starting another — teardown hooks are not
// idempotent, and a pool closed twice is the defect this seam exists to prevent.
//
// The stop is deliberately not in a group. A `close()` that ran before the
// application listened must not make a later one a no-op: the server would stay
// bound and outlive the call that was supposed to end it. Stopping an
// application with no server costs nothing, so the stop is asked for every time.
let beforeShutdownDone: Promise<void> | undefined;
let afterStopDone: Promise<void> | undefined;

attachApplicationShutdown(nativeApplication, async (closeActiveConnections = true) => {
  beforeShutdownDone ??= runShutdownHooks(beforeShutdown, logger);
  await beforeShutdownDone;

  if (nativeApplication.server) {
    await nativeApplication.stop(closeActiveConnections);
  }

  afterStopDone ??= (async () => {
    await runShutdownHooks(moduleDestroy, logger);
    await runShutdownHooks(applicationShutdown, logger);
  })();
  await afterStopDone;
});
```

and add this helper beside the other module-level functions in the same file:

```ts
/**
 * Runs shutdown hooks in order, reporting a failure and carrying on.
 *
 * A pool that refuses to close must not be able to keep every other pool open,
 * and `close()` may not become a call that cannot complete, so each failure is
 * reported where an application reads its logs and the next hook still runs.
 * This is a failure-reporting call site and goes through the same guarded seam
 * the default mapping does.
 */
async function runShutdownHooks(
  calls: readonly LifecycleCall[],
  logger: LoggerService | undefined,
): Promise<void> {
  for (const call of calls) {
    try {
      await call();
    } catch (error) {
      reportThroughLogger(logger, error, "ExceptionsHandler");
    }
  }
}
```

Add `attachApplicationShutdown`, `collectLifecycleCalls`, and `type LifecycleCall` to the imports
from `./lifecycle-hooks.ts`, and `reportThroughLogger` to the existing import from
`../errors/default-exception-filter.ts`. `LoggerService` is already imported in this file for the
logger it threads through the boot; if it is not, add the type import.

Then, in `packages/platform-elysia/src/application/aponia-elysia-application.ts`, add
`readApplicationShutdown` to the imports from `./lifecycle-hooks.ts` before the next step.

- [ ] **Step 4: Read the plan in `close()`**

In `packages/platform-elysia/src/application/aponia-elysia-application.ts`, replace the body of
`close()` with:

```ts
  async close(closeActiveConnections = true): Promise<void> {
    // A boot attaches the plan; an application no boot produced has none, and
    // keeps the behaviour this method had before the seam existed.
    const shutdown = readApplicationShutdown(this.#nativeApplication);
    if (shutdown) {
      await shutdown(closeActiveConnections);
      return;
    }

    if (this.#nativeApplication.server) {
      await this.#nativeApplication.stop(closeActiveConnections);
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/platform-elysia/tests/lifecycle.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 6: Record the fourth reporting call site everywhere the rule is enumerated**

The rule is one rule with one list, and that list lives in three places. All three gain the new
site, described the way the others are — the shutdown runner, which reports a hook that threw while
the application was stopping and carries on, because `close()` may not become a call that cannot
complete:

1. **`packages/platform-elysia/AGENTS.md`** — the invariant names three call sites. Edit that
   sentence rather than adding a bullet.
2. **`packages/common/src/logging/logger.types.ts`** — the `LoggerService` doc comment enumerates
   the same sites ("the framework's default mapping …; its declared filter hook …; `listen` …; and
   the devtools server's two rows …"). Add the shutdown runner to that enumeration.
3. **`docs/logging.md`** — the published prose carries the same list. Add it there too.

A list that names the guarded call sites and omits one is the documentation claiming less than the
code does, which reads to a reader as permission to do the same.

- [ ] **Step 7: Mirror the stopping half in the conformance lane**

Add to `packages/platform-elysia/tests-vp/lifecycle.conformance.ts`:

```ts
test("runs a provider's onApplicationShutdown through a real close", async () => {
  const calls: string[] = [];

  class Hooked implements OnApplicationShutdown {
    onApplicationShutdown(): void {
      calls.push("shutdown");
    }
  }

  @Module({ providers: [provideClass(Hooked, [])] })
  class HookedModule {}

  const application = await AponiaFactory.create(HookedModule, { logger: false });
  await application.close();
  // The second close also exercises the once-only rule in this lane: both lanes
  // mirror framework behaviour, and a teardown that ran twice would show here as
  // two entries rather than one.
  await application.close();

  expect(calls).toEqual(["shutdown"]);
});
```

- [ ] **Step 8: Run the gates and commit**

```bash
bun run check --fix
bun test packages/platform-elysia/tests/lifecycle.test.ts
bun run --filter @aponiajs/platform-elysia test
bunx vp test packages/platform-elysia/tests-vp/lifecycle.conformance.ts
bun test scripts/
git add packages/platform-elysia
git commit -m "feat(platform-elysia): stop a provider through the hook its instance declares"
```

---

### Task 4: The documentation

**Files:**

- Create: `docs/lifecycle.md`
- Create: `docs/learn/16-lifecycle.md`
- Modify: `docs/learn/15-files.md` (it stops being the last chapter)
- Modify: `docs/learn/README.md` (the chapter table and the reference paragraph)
- Modify: `docs/AGENTS.md` (the published-document table)
- Modify: `README.md` (the navigation list, the implemented paragraph, and the not-implemented list)
- Modify: `AGENTS.md` (the current-scope implemented paragraph)

**Interfaces:**

- Consumes: the behaviour Tasks 2 and 3 fixed.
- Produces: the pages Task 5's example points at.

- [ ] **Step 1: Write the reference page**

`docs/lifecycle.md`:

````markdown
# Lifecycle

A provider can run code at five moments without a decorator, a descriptor field, or any
registration: the framework reads the method off the instance, the way it reads an interceptor's
halves.

| Hook                        | Runs                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `onModuleInit`              | Once per module, in graph order, after the boot's controller pass and before the gateway pass |
| `onApplicationBootstrap`    | Once, after every route and gateway is mounted, before the application can listen             |
| `beforeApplicationShutdown` | Once, at the start of `close()`, before the server stops                                      |
| `onModuleDestroy`           | Once per module in reverse graph order, after the server has stopped                          |
| `onApplicationShutdown`     | Once, last                                                                                    |

```ts
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@aponiajs/common";

@Injectable()
export class PoolService implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    // the graph is instantiated; this module's providers and controllers exist
  }

  onApplicationShutdown(): void {
    // the server has stopped; nothing else will ask this provider for anything
  }
}
```
````

`implements` is optional. An interface is how a signature drift becomes a compile error, and the
framework never reads the type: a class registered with `provideClass` and no decorator at all
carries these hooks exactly the same way, because the instance holds the method.

## The order

Modules run in graph order — a module that imports another initializes after it and is destroyed
before it — and within a module its providers run in declaration order, with its controllers after
them. Instantiation does not interleave with the hooks: the boot instantiates every module's
providers and controllers first, so `onModuleInit` orders modules rather than enclosing one.

A hook may return a promise, and the boot awaits it.

## When a hook fails

A hook that throws while the application is starting fails the boot, and the value you threw is
what your caller catches — the framework does not wrap it. Hooks that had not run yet do not run.

A hook that throws while the application is stopping is reported through the system logger and the
remaining hooks still run; `close()` still stops the server. A connection pool that refuses to
close must not be able to keep every other pool open.

## `close()` without `listen()`

The stopping hooks run whether or not the application ever listened, which is what makes them
testable through `application.handle` — the way every suite in this repository drives an
application — without binding a port.

````

- [ ] **Step 2: Write the chapter and chain it**

`docs/learn/16-lifecycle.md`:

```markdown
# 16 · Lifecycle

**Use when:** something has to happen when the application starts, or to be closed when it stops.

A provider declares what it needs to do at each moment as a method. There is nothing to register:

```ts
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@aponiajs/common";

@Injectable()
export class CacheService implements OnModuleInit, OnApplicationShutdown {
  onModuleInit(): void {
    // warm the cache once the graph is up
  }

  onApplicationShutdown(): void {
    // flush it once the server has stopped
  }
}
````

The five methods are `onModuleInit`, `onApplicationBootstrap`, `beforeApplicationShutdown`,
`onModuleDestroy`, and `onApplicationShutdown`, named as Nest names them. `onApplicationBootstrap`
is the one to reach for when the hook needs the whole application rather than its own module.

Next: nothing — this is the last chapter. ·
Deep dive: [lifecycle](../lifecycle.md)

````

Then, in the same change: replace the tail of `docs/learn/15-files.md` — which currently ends
`Next: nothing — this is the last chapter. ·` followed by `Deep dive: [files](../files.md)` — with
`Next: [16 · Lifecycle](./16-lifecycle.md) · Deep dive: [files](../files.md)`; add the row
`| [16 · Lifecycle](./16-lifecycle.md) | What runs when the application starts and stops |` to the
table in `docs/learn/README.md`; and add `[lifecycle](../lifecycle.md)` to that file's reference
paragraph.

- [ ] **Step 3: Add the page to the two indexes**

In `docs/AGENTS.md`, add a row to the published-document table after the `files.md` row:

```markdown
| `lifecycle.md`              | The five moments a provider can hook, and what the framework does when one fails                |
````

In `README.md`, add `[Lifecycle](./docs/lifecycle.md) ·` to the navigation list.

- [ ] **Step 4: Move the two scope-of-record lists**

`README.md`'s not-implemented list currently opens `Not implemented yet: async provider lifecycle,
request and transient scopes, …`. Remove `async provider lifecycle, ` from it. `AGENTS.md`'s
not-implemented list never named it, so it is unchanged.

Both lists have an implemented half, and both are the scope of record, so the same phrase is added
to each: in `README.md`'s implemented paragraph and in `AGENTS.md`'s, add

```markdown
provider and application lifecycle hooks, read from the provider instance
```

in the enumeration style those paragraphs already use.

- [ ] **Step 5: Run the documentation gates and commit**

```bash
bun run check --fix
bun test scripts/learning-path.spec.ts scripts/documentation.spec.ts scripts/retired-literals.spec.ts
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add docs README.md AGENTS.md
git commit -m "docs(lifecycle): teach the five moments where a reader looks for them"
```

Expected: the learning path sees 16 contiguous chapters, and the Thai scan reports nothing.

---

### Task 5: The example

**Files:**

- Create: `examples/lifecycle/package.json`
- Create: `examples/lifecycle/tsconfig.json` (copy of `examples/validation/tsconfig.json`)
- Create: `examples/lifecycle/vite.config.ts` (copy of `examples/validation/vite.config.ts`)
- Create: `examples/lifecycle/src/app.module.ts`
- Create: `examples/lifecycle/src/app.service.ts`
- Create: `examples/lifecycle/src/app.controller.ts`
- Create: `examples/lifecycle/src/main.ts`
- Create: `examples/lifecycle/test/application.ts`
- Create: `examples/lifecycle/test/lifecycle.e2e-spec.ts`
- Create: `examples/lifecycle/README.md`
- Modify: `package.json` (the `example:*` script block)
- Modify: `examples/README.md` (the index table)
- Modify: `examples/AGENTS.md` (the name list)
- Modify: `bun.lock` (via `bun install`, never by hand)
- Test: `examples/lifecycle/test/lifecycle.e2e-spec.ts`

**Interfaces:**

- Consumes: the contracts from Task 1 and the behaviour from Tasks 2 and 3.
- Produces: an application a person can run to watch a provider start and stop.

- [ ] **Step 1: Create the package skeleton**

`examples/lifecycle/package.json`:

```json
{
  "name": "@aponiajs/example-lifecycle",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/main.ts",
    "build": "bun build ./src/main.ts --outdir ./dist --target bun",
    "test": "bun test ../../examples/lifecycle/test/*.e2e-spec.ts",
    "check": "vp check"
  },
  "dependencies": {
    "@aponiajs/common": "workspace:*",
    "@aponiajs/platform-elysia": "workspace:*",
    "elysia": "^1.4.30"
  }
}
```

Copy `examples/validation/tsconfig.json` and `examples/validation/vite.config.ts` into
`examples/lifecycle/` unchanged.

- [ ] **Step 2: Write the failing test**

`examples/lifecycle/test/application.ts`:

```ts
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application; the topic's state is module-level. */
export function createApplication(): Promise<AponiaElysiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
}

export function get(
  application: AponiaElysiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}
```

`examples/lifecycle/test/lifecycle.e2e-spec.ts`:

```ts
import { beforeEach, expect, test } from "bun:test";
import { announcements } from "../src/app.service.ts";
import { createApplication, get } from "./application.ts";

beforeEach(() => {
  announcements.length = 0;
});

test("a provider announces its own start, before the first request", async () => {
  const application = await createApplication();

  const response = await get(application, "/lifecycle/record");

  expect(await response.json()).toEqual({ started: true });
  expect(announcements).toEqual(["onModuleInit"]);

  await application.close();
});

test("its stop arrives when the application closes", async () => {
  const application = await createApplication();

  await application.close();

  expect(announcements).toEqual(["onModuleInit", "onApplicationShutdown"]);
});
```

The second case is the one that matters: the stop hook cannot be observed through a route, because
by the time it runs the application is closed, so the example keeps its own record of what the
hooks announced and the suite reads that.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test ./examples/lifecycle/test/*.e2e-spec.ts`
Expected: FAIL — `Cannot find module '../src/app.module.ts'`.

- [ ] **Step 4: Write the application**

`examples/lifecycle/src/app.service.ts`:

```ts
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@aponiajs/common";

/**
 * What the hooks announced, in order.
 *
 * The example's own record rather than the framework's: a stop hook runs after
 * the application is closed, so nothing can ask a route about it afterwards,
 * and the suite reads this instead.
 */
export const announcements: string[] = [];

/**
 * Announces its own start and stop. Nothing registers it and nothing names the
 * hooks: the framework reads them from this instance.
 */
@Injectable()
export class AppService implements OnModuleInit, OnApplicationShutdown {
  #started = false;

  onModuleInit(): void {
    this.#started = true;
    announcements.push("onModuleInit");
  }

  onApplicationShutdown(): void {
    announcements.push("onApplicationShutdown");
  }

  record(): { started: boolean } {
    return { started: this.#started };
  }
}
```

`examples/lifecycle/src/app.controller.ts`:

```ts
import { Controller, Get } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

@Controller("lifecycle")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("record")
  read(): { started: boolean } {
    return this.appService.record();
  }
}
```

`examples/lifecycle/src/app.module.ts`:

```ts
import { Module } from "@aponiajs/common";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";

@Module({ providers: [AppService], controllers: [AppController] })
export class AppModule {}
```

`examples/lifecycle/src/main.ts`:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(Number(Bun.env.PORT ?? 3090));
}

if (import.meta.main) {
  await bootstrap();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test ./examples/lifecycle/test/*.e2e-spec.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 6: Write the example README**

`examples/lifecycle/README.md`:

````markdown
# Lifecycle

A provider announces its own start and stop with two methods. Nothing registers them, no decorator
marks them, and the same class registered by a hand-written descriptor carries them unchanged,
because the framework reads the method from the instance.

## Run

```bash
bun run example:lifecycle
```

## Test

```bash
bun run --cwd examples/lifecycle test
```

`test/lifecycle.e2e-spec.ts` reads the provider's state through a route before closing, then closes
the application and asserts the stop hook ran and in which order — the one moment a route cannot
report, because by then the application is closed.

[Every example](../README.md)
````

- [ ] **Step 7: Register the example**

1. In the root `package.json`, add after `"example:files"`:

```json
"example:lifecycle": "bun run --cwd examples/lifecycle start",
```

2. In `examples/README.md`, append this row to the table (the rows are ordered by port):

```markdown
| `lifecycle` | A provider that announces its own start and stop | 3090 | `bun run example:lifecycle` |
```

3. In `examples/AGENTS.md`, add `lifecycle` to the end of the named list, so it reads
   `…, websockets, files, lifecycle`.

4. Register the workspace in the lockfile:

```bash
bun install
```

Expected: `bun.lock` gains `examples/lifecycle`.

- [ ] **Step 8: Run the gates and commit**

```bash
bun run check --fix
bun test ./examples/lifecycle/test/*.e2e-spec.ts
bun run test:examples
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
git add examples/lifecycle package.json examples/README.md examples/AGENTS.md bun.lock
git commit -m "feat(examples): show a provider announcing its own start and stop"
```

---

## Whole-branch verification

After Task 5, on the branch as a whole:

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun run release:dry-run
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
bun run test:generated-app
bun test scripts/
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
```

`test:coverage` is the lane that fails first if the new platform modules are imported but never
exercised: `scripts/coverage-gate.ts` discovers runtime sources by glob and requires every one in
LCOV, and the floor is 95% line and function coverage. `release:dry-run` is required because a
published package's contents change.

## What this plan does not do

- **No push and no version bump.** Both belong to the push, and a push to a release branch
  publishes every package.
- **Nothing about scheduled work.** The cron recipe and the `@aponiajs/schedule` question are
  separate; this seam is what either would stand on.
- **No request or transient scope.** `README.md`'s not-implemented list keeps
  `request and transient scopes` exactly as it is, and this plan removes only the lifecycle phrase
  beside it.
- **No devtools reporting of lifecycle halves.** It reports interceptor halves and could report
  these the same way; that is a follow-up, and nothing here needs it.
