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
  NotFoundException,
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
import { AponiaFactory } from "./index.ts";

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

test("repeated APP_GUARD registrations run once each, in declaration order", async () => {
  calls.length = 0;

  @Injectable()
  class First implements CanActivate {
    canActivate(): boolean {
      calls.push("first");
      return true;
    }
  }
  @Injectable()
  class Second implements CanActivate {
    canActivate(): boolean {
      calls.push("second");
      return true;
    }
  }
  @Controller("repeated")
  class RepeatedController {
    @Get()
    read(): string {
      calls.push("handler");
      return "read";
    }
  }

  @Module({
    controllers: [RepeatedController],
    providers: [
      First,
      Second,
      { provide: APP_GUARD, useValue: First },
      { provide: APP_GUARD, useValue: Second },
    ],
  })
  class RepeatedModule {}

  const application = await AponiaFactory.create(RepeatedModule, { logger: false });
  await application.handle(new Request("http://localhost/repeated"));

  expect(calls).toEqual(["first", "second", "handler"]);
  await application.close();
});

test("an array under APP_GUARD expands in place", async () => {
  calls.length = 0;

  @Injectable()
  class Before implements CanActivate {
    canActivate(): boolean {
      calls.push("before");
      return true;
    }
  }
  @Injectable()
  class Listed implements CanActivate {
    canActivate(): boolean {
      calls.push("listed");
      return true;
    }
  }
  @Injectable()
  class After implements CanActivate {
    canActivate(): boolean {
      calls.push("after");
      return true;
    }
  }
  @Controller("expanded")
  class ExpandedController {
    @Get()
    read(): string {
      return "read";
    }
  }

  @Module({
    controllers: [ExpandedController],
    providers: [
      Before,
      Listed,
      After,
      { provide: APP_GUARD, useValue: Before },
      { provide: APP_GUARD, useValue: [Listed, After] },
    ],
  })
  class ExpandedModule {}

  const application = await AponiaFactory.create(ExpandedModule, { logger: false });
  await application.handle(new Request("http://localhost/expanded"));

  expect(calls).toEqual(["before", "listed", "after"]);
  await application.close();
});

test("application.get refuses an APP_* pseudo-provider", async () => {
  const application = await AponiaFactory.create(ApplicationEnhancerModule, { logger: false });

  expect(() => application.get(APP_GUARD)).toThrow(
    expect.objectContaining({ code: "MISSING_PROVIDER" }),
  );
  await application.close();
});

test("the surface methods configure the boot through init()", async () => {
  calls.length = 0;

  @Injectable()
  class SurfaceGuard implements CanActivate {
    canActivate(): boolean {
      calls.push("surface-guard");
      return true;
    }
  }
  @Controller("surface")
  class SurfaceController {
    @Get()
    read(): string {
      return "surface";
    }
  }

  @Module({ controllers: [SurfaceController], providers: [SurfaceGuard] })
  class SurfaceModule {}

  const application = await AponiaFactory.create(SurfaceModule, { logger: false });
  application.useGlobalGuards(SurfaceGuard);
  application.setGlobalPrefix("/api");
  await application.init();

  const response = await application.handle(new Request("http://localhost/api/surface"));
  expect(await response.text()).toBe("surface");
  expect(calls).toEqual(["surface-guard"]);
  await application.close();
});

test("the surface exposes the HTTP adapter and server accessors", async () => {
  const application = await AponiaFactory.create(ApplicationEnhancerModule, { logger: false });

  expect(application.getHttpAdapter()).toBe(application.getNativeApplication());
  expect(application.getHttpServer()).toBeUndefined();
  await application.init();
  await application.close();
});

test("the surface configures policies, logging, and shutdown hooks", async () => {
  const lines: string[] = [];
  const logger = {
    log: (message: unknown) => lines.push(String(message)),
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };
  const application = await AponiaFactory.create(ApplicationEnhancerModule, { logger: false });
  application.useLogger(logger);
  application.enableCors(true);
  application.useSecurityHeaders();
  application.flushLogs();
  application.enableShutdownHooks();
  await application.init();

  expect(() => application.useSecurityHeaders()).toThrow(
    expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
  );

  const response = await application.handle(
    new Request("http://localhost/enhanced", { headers: { origin: "https://example.com" } }),
  );
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  await application.close();
});

test("a thrown HttpException answers through its own status", async () => {
  @Controller("http-exception")
  class HttpExceptionController {
    @Get()
    read(): never {
      throw new NotFoundException("missing");
    }
  }

  @Module({ controllers: [HttpExceptionController] })
  class HttpExceptionModule {}

  const application = await AponiaFactory.create(HttpExceptionModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/http-exception"));
  expect(response.status).toBe(404);
  await application.close();
});
