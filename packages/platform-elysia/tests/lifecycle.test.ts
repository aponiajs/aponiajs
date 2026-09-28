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

    class Stopping implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown {
      // Asynchronous on purpose: the order below is what fails if the runner
      // stops awaiting between hooks, and a synchronous set could not tell.
      async beforeApplicationShutdown(): Promise<void> {
        await Bun.sleep(1);
        calls.push("before");
      }

      onModuleDestroy(): void {
        calls.push("destroy");
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
    // The hooks are only half of what the name claims: deleting the plan's
    // `stop` call leaves every other case in the suite green, so this is the
    // line that fails when `close()` stops running the server.
    expect(application.getNativeApplication().server).toBeNull();
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

  test("report a throwing hook and still run the rest, with the server stopped", async () => {
    calls.length = 0;
    const reported: string[] = [];
    const failure = new Error("could not close the pool");

    class RecordingLogger implements LoggerService {
      log(): void {}
      fatal(): void {}
      warn(): void {}
      debug(): void {}
      verbose(): void {}

      error(message: unknown): void {
        reported.push(String(message));
      }
    }

    class Refusing implements OnApplicationShutdown {
      onApplicationShutdown(): void {
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

    await application.close();

    expect(calls).toEqual(["refusing", "after"]);
    expect(reported.join("\n")).toContain("could not close the pool");
  });
});
