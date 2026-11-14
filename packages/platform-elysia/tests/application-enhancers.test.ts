import { expect, test } from "bun:test";
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  provideValue,
  UseGuards,
  Body,
  type ArgumentsHost,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type Interceptor,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

const calls: string[] = [];

@Injectable()
class ApplicationGuard implements CanActivate {
  canActivate(_execution: ExecutionContext): boolean {
    calls.push("application-guard");
    return true;
  }
}

@Injectable()
class ControllerGuard implements CanActivate {
  canActivate(_execution: ExecutionContext): boolean {
    calls.push("controller-guard");
    return true;
  }
}

@Injectable()
class MarkerInterceptor implements Interceptor {
  interceptBefore(_execution: ExecutionContext): void {
    calls.push("interceptor-before");
  }

  interceptAfter(_execution: ExecutionContext, response: unknown): unknown {
    calls.push("interceptor-after");
    return response;
  }
}

@Catch()
@Injectable()
class ApplicationFilter implements ExceptionFilter {
  catch(_exception: unknown, _host: ArgumentsHost): Response {
    return new Response("filtered", { status: 418 });
  }
}

@Injectable()
class UpperPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return typeof value === "string" ? value.toUpperCase() : value;
  }
}

@Controller("enhanced")
@UseGuards(ControllerGuard)
class EnhancedController {
  @Get()
  read(): string {
    calls.push("handler");
    return "read";
  }
}

@Controller("failing")
class FailingController {
  @Get()
  read(): string {
    throw new Error("handler failure");
  }
}

@Controller("piped")
class PipedController {
  @Post()
  create(@Body("name") name: string): string {
    return name;
  }
}

@Module({
  controllers: [EnhancedController, FailingController, PipedController],
  providers: [
    ApplicationGuard,
    ControllerGuard,
    MarkerInterceptor,
    ApplicationFilter,
    UpperPipe,
    { provide: APP_GUARD, useValue: ApplicationGuard },
    { provide: APP_INTERCEPTOR, useValue: MarkerInterceptor },
    { provide: APP_FILTER, useValue: ApplicationFilter },
    { provide: APP_PIPE, useValue: UpperPipe },
  ],
})
class ApplicationEnhancerModule {}

test("the APP_* tokens run application-wide, before the controller's own declarations", async () => {
  calls.length = 0;
  const application = await AponiaFactory.create(ApplicationEnhancerModule, { logger: false });

  const guardResponse = await application.handle(new Request("http://localhost/enhanced"));
  expect(await guardResponse.text()).toBe("read");
  // The after half runs once the handler has answered, before `handle`
  // resolves, so the measured order is the whole lifecycle.
  expect(calls).toEqual([
    "application-guard",
    "controller-guard",
    "interceptor-before",
    "handler",
    "interceptor-after",
  ]);

  await application.close();
});

test("the APP_FILTER token answers a failure from a route that declares no filter", async () => {
  const application = await AponiaFactory.create(ApplicationEnhancerModule, { logger: false });

  const response = await application.handle(new Request("http://localhost/failing"));

  expect(response.status).toBe(418);
  expect(await response.text()).toBe("filtered");
  await application.close();
});

test("the APP_PIPE token transforms a route parameter", async () => {
  const application = await AponiaFactory.create(ApplicationEnhancerModule, { logger: false });

  const response = await application.handle(
    new Request("http://localhost/piped", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "aponia" }),
    }),
  );

  expect(await response.text()).toBe("APONIA");
  await application.close();
});

test("a list under one token states several enhancers in run order", async () => {
  calls.length = 0;

  @Injectable()
  class FirstGuard implements CanActivate {
    canActivate(): boolean {
      calls.push("first");
      return true;
    }
  }
  @Injectable()
  class SecondGuard implements CanActivate {
    canActivate(): boolean {
      calls.push("second");
      return true;
    }
  }
  @Controller("listed")
  class ListedController {
    @Get()
    read(): string {
      return calls.join(",");
    }
  }

  @Module({
    controllers: [ListedController],
    providers: [
      FirstGuard,
      SecondGuard,
      { provide: APP_GUARD, useValue: [FirstGuard, SecondGuard] },
    ],
  })
  class ListedModule {}

  const application = await AponiaFactory.create(ListedModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/listed"));

  expect(await response.text()).toBe("first,second");
  await application.close();
});

test("an APP_* class the root cannot reach fails the boot", async () => {
  class UnregisteredGuard implements CanActivate {
    canActivate(): boolean {
      return true;
    }
  }

  @Controller("unreachable")
  class UnreachableController {
    @Get()
    read(): string {
      return "read";
    }
  }

  @Module({
    controllers: [UnreachableController],
    providers: [{ provide: APP_GUARD, useValue: UnregisteredGuard }],
  })
  class UnreachableModule {}

  const failure = await AponiaFactory.create(UnreachableModule, { logger: false }).then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(failure).toMatchObject({ code: "MISSING_PROVIDER" });
});

test("an instance under an application token is used as given", async () => {
  const filter = new ApplicationFilter();

  @Controller("instance-filtered")
  class InstanceFilteredController {
    @Get()
    read(): string {
      throw new Error("handler failure");
    }
  }

  @Module({
    controllers: [InstanceFilteredController],
    providers: [
      { provide: APP_FILTER, useValue: filter },
      { provide: APP_PIPE, useValue: undefined },
    ],
  })
  class InstanceModule {}

  const application = await AponiaFactory.create(InstanceModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/instance-filtered"));

  expect(response.status).toBe(418);
  expect(await response.text()).toBe("filtered");
  await application.close();
});

test("refuses an application-level pipe class the root cannot reach", async () => {
  class UnregisteredPipe implements PipeTransform {
    transform(value: unknown): unknown {
      return value;
    }
  }

  @Module({})
  class EmptyModule {}

  const optionFailure = await AponiaFactory.create(EmptyModule, {
    logger: false,
    pipes: [UnregisteredPipe],
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(optionFailure).toMatchObject({ code: "MISSING_PROVIDER" });

  @Module({ providers: [{ provide: APP_PIPE, useValue: UnregisteredPipe }] })
  class TokenModule {}

  const tokenFailure = await AponiaFactory.create(TokenModule, { logger: false }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(tokenFailure).toMatchObject({ code: "MISSING_PROVIDER" });

  class NotAPipe {}
  @Module({
    providers: [provideValue(NotAPipe, "not a pipe"), { provide: APP_PIPE, useValue: NotAPipe }],
  })
  class WrongValueModule {}

  const wrongValueFailure = await AponiaFactory.create(WrongValueModule, { logger: false }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(wrongValueFailure).toMatchObject({ code: "INVALID_PIPE" });
});
