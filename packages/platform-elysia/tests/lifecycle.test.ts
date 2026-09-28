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
