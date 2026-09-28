import { afterEach, describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  createToken,
  provideClass,
  provideValue,
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
