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
  type BeforeApplicationShutdown,
  type LoggerService,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
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

    @Injectable()
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

  test("calls a hook a function carries, because a function carries properties too", async () => {
    calls.length = 0;
    // The widened half of the reader's guard: a function is not skipped, because
    // it can carry the hook the same way an object can, and a value provider may
    // be one. The case below still pins the input the guard's early return exists
    // for.
    const hooked = Object.assign((): void => {}, {
      onModuleInit(): void {
        calls.push("function:init");
      },
    });
    const token = createToken<typeof hooked>("LIFECYCLE_FUNCTION");

    @Module({ providers: [provideValue(token, hooked)] })
    class FunctionModule {}

    application = await AponiaFactory.create(FunctionModule, { logger: false });

    expect(calls).toEqual(["function:init"]);
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

  test("fails the boot from onApplicationBootstrap with the thrown value unchanged", async () => {
    calls.length = 0;
    const failure = new Error("bootstrap refused");

    // The same shape as the `onModuleInit` case above, over the loop that is its
    // own call site: `onApplicationBootstrap` runs after every route and gateway
    // is mounted, so nothing else in this file proves a throw there reaches the
    // caller rather than being swallowed by the boot it interrupts.
    class Refusing implements OnApplicationBootstrap {
      onApplicationBootstrap(): void {
        calls.push("refusing:bootstrap");
        throw failure;
      }
    }

    class After implements OnApplicationBootstrap {
      onApplicationBootstrap(): void {
        calls.push("after:bootstrap");
      }
    }

    @Module({ providers: [provideClass(Refusing, []), provideClass(After, [])] })
    class RefusingBootstrapModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(RefusingBootstrapModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failure);
    expect(calls).toEqual(["refusing:bootstrap"]);
  });
});

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
        stoppedWhenCalled.push(application?.getNativeApplication().server === null);
      }

      async onModuleDestroy(): Promise<void> {
        await Bun.sleep(1);
        calls.push("destroy");
        stoppedWhenCalled.push(application?.getNativeApplication().server === null);
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

  test("hand the caller's close policy to the server the plan stops", async () => {
    calls.length = 0;

    class Policy implements OnApplicationShutdown {
      onApplicationShutdown(): void {
        calls.push("shutdown");
      }
    }

    @Module({ providers: [provideClass(Policy, [])] })
    class PolicyModule {}

    application = await AponiaFactory.create(PolicyModule, { logger: false });
    await application.listen(0);

    // The policy is the whole opt-in: `close()` terminates what is in flight and
    // `close(false)` drains it, and handing that flag to `stop` is the plan's
    // job. Recording what the plan hands over is what makes a plan that dropped
    // the flag fail here; the hand-built fallback case in `platform.test.ts`
    // never reads a boot's plan, so it cannot see that change at all.
    const policies: (boolean | undefined)[] = [];
    const native = application.getNativeApplication();
    const stop = native.stop.bind(native);
    native.stop = async (closeActiveConnections?: boolean) => {
      policies.push(closeActiveConnections);
      return await stop(closeActiveConnections);
    };

    await application.close();
    // Listening again binds a fresh server, so the opt-in is observed against a
    // live one rather than against a stop that had nothing left to stop.
    await application.listen(0);
    await application.close(false);

    expect(policies).toEqual([true, false]);
    expect(application.getNativeApplication().server).toBeNull();
    // The stopping hooks still run once whatever policy stops the server.
    expect(calls).toEqual(["shutdown"]);
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

    @Injectable()
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

    // One hook in each group, so the case covers both memoised groups and not
    // only the one after the stop.
    class Once implements BeforeApplicationShutdown, OnApplicationShutdown {
      beforeApplicationShutdown(): void {
        calls.push("before");
      }

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
    expect(calls).toEqual(["before", "shutdown"]);
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

    const first = application.close();
    const second = application.close();
    // The second caller is awaited on its own, before the first, and that is what
    // pins the join: a `close()` that resolved instead of joining the teardown
    // already running would resolve here with `calls` still empty, while the
    // first was still sleeping in its hook. Awaiting both together could not tell
    // the two apart — the first caller has finished the teardown by the time
    // either is observed — and both callers waited for the same teardown: one
    // that returned early would tell a caller an application is down that is not.
    await second;
    expect(calls).toEqual(["shutdown"]);

    await first;
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
