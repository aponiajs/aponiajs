import { describe, expect, test } from "bun:test";
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  UseFilters,
  Controller,
  Get,
  Injectable,
  Module,
  Scope,
  createToken,
  provideValue,
  type CanActivate,
  type ExceptionFilter,
  type BeforeApplicationShutdown,
  type Interceptor,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from "@aponiajs/common";
import { createPlatformFactory } from "../index.ts";
import { fakeHost } from "../../test/fixtures/fake-host.ts";

interface FakeApp {
  readonly name: string;
}

const order: string[] = [];

@Injectable()
class Intercepting implements Interceptor {
  interceptAfter(): unknown {
    return undefined;
  }
}

@Injectable()
class ShutdownSignal implements BeforeApplicationShutdown {
  beforeApplicationShutdown(signal?: string): void {
    order.push(`before:${signal ?? "none"}`);
  }
}

@Injectable()
class Teardown implements OnModuleDestroy, OnApplicationShutdown {
  onModuleDestroy(): void {
    order.push("destroy");
  }

  onApplicationShutdown(): void {
    order.push("shutdown");
  }
}

@Injectable()
class DenyAll implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Injectable()
class Everything implements ExceptionFilter {
  catch(error: unknown): Response {
    return new Response(String((error as Error).message), { status: 599 });
  }
}

const ID = createToken<number>("ID");

@Controller("scoped")
@Injectable({ scope: Scope.REQUEST })
class ScopedController {
  @Get()
  run(): number {
    return Math.floor(Date.now() / 1_000_000);
  }
}

@Controller("global")
class GlobalController {
  @Get()
  run(): string {
    return "global";
  }
}

@Module({
  controllers: [GlobalController],
  providers: [
    DenyAll,
    Everything,
    Intercepting,
    ShutdownSignal,
    Teardown,
    provideValue(APP_GUARD, DenyAll),
    provideValue(APP_FILTER, Everything),
    provideValue(APP_INTERCEPTOR, Intercepting),
    provideValue(ID, 7),
  ],
})
class GuardedModule {}

@Module({ controllers: [ScopedController] })
class ScopedModule {}

describe("the platform boot", () => {
  test("runs the shutdown passes in order on close", async () => {
    order.length = 0;
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(GuardedModule);
    await application.close();

    expect(order).toEqual(["before:none", "destroy", "shutdown"]);
  });

  test("accepts a global enhancer declared as an instance or a list", async () => {
    @Controller("instances")
    class InstanceController {
      @Get()
      run(): string {
        return "ok";
      }
    }

    @Module({
      controllers: [InstanceController],
      providers: [
        provideValue(APP_GUARD, [new DenyAll()]),
        provideValue(APP_INTERCEPTOR, new Intercepting()),
      ],
    })
    class InstanceModule {}

    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(InstanceModule);
    const response = await application.handle(new Request("http://localhost/instances"));

    expect(response.status).toBe(403);
    await application.close();
  });

  test("resolves a filter a controller declares", async () => {
    @Controller("filtered")
    @UseFilters(Everything)
    class FilteredController {
      @Get()
      run(): never {
        throw new Error("declared filter");
      }
    }

    @Module({ controllers: [FilteredController], providers: [Everything] })
    class FilteredModule {}

    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(FilteredModule);
    const response = await application.handle(new Request("http://localhost/filtered"));

    expect(response.status).toBe(599);
    expect(await response.text()).toBe("declared filter");
    await application.close();
  });

  test("applies a global guard to every route", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(GuardedModule);
    const response = await application.handle(new Request("http://localhost/global"));

    expect(response.status).toBe(403);
    await application.close();
  });

  test("offers an unhandled failure to a global filter", async () => {
    @Controller("plain")
    class PlainController {
      @Get()
      run(): never {
        throw new Error("boom");
      }
    }

    @Module({
      controllers: [PlainController],
      providers: [Everything, provideValue(APP_FILTER, Everything)],
    })
    class FailingModule {}

    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(FailingModule);
    const response = await application.handle(new Request("http://localhost/plain"));

    expect(response.status).toBe(599);
    expect(await response.text()).toBe("boom");
    await application.close();
  });

  test("constructs a request-scoped controller per request", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(ScopedModule);
    const first = await application.handle(new Request("http://localhost/scoped"));
    const second = await application.handle(new Request("http://localhost/scoped"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await application.close();
  });

  test("resolves a token through the application", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(GuardedModule);

    expect(application.get(ID)).toBe(7);
    await application.close();
  });

  test("lets an application adjust the native instance before mounting", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(GuardedModule, {
      configureNative: (native) => ({ ...(native as FakeApp), name: "configured" }),
    });

    expect(application.getNativeApplication().name).toBe("configured");
    await application.close();
  });

  test("declines through tryHandle and reports the platform name", async () => {
    const factory = createPlatformFactory(fakeHost());
    const application = await factory.create(ScopedModule);

    expect(await application.tryHandle(new Request("http://localhost/none"))).toBeUndefined();
    expect(application.platform).toBe("fake");
    await application.close();
  });
});
