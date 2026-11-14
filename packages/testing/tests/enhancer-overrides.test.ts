import { expect, test } from "bun:test";
import {
  Catch,
  Controller,
  createToken,
  defineModule,
  Get,
  Injectable,
  Module,
  Param,
  provideValue,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UsePipes,
  type ArgumentsHost,
  type CanActivate,
  type ExceptionFilter,
  type Interceptor,
  type PipeTransform,
} from "@aponiajs/common";
import { defineController } from "@aponiajs/platform-elysia";
import { createTestApplication } from "../src/index.ts";

const calls: string[] = [];

@Injectable()
class RefusingGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Injectable()
class MarkingInterceptor implements Interceptor {
  interceptBefore(): void {
    calls.push("original");
  }
}

@Catch()
@Injectable()
class OriginalFilter implements ExceptionFilter {
  catch(_exception: unknown, _host: ArgumentsHost): Response {
    return new Response("original", { status: 500 });
  }
}

@Injectable()
class LiteralPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return `literal:${String(value)}`;
  }
}

@Injectable()
class UpperPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return typeof value === "string" ? value.toUpperCase() : value;
  }
}

@Controller("guarded")
@UseGuards(RefusingGuard)
class GuardedController {
  @Get()
  read(): string {
    return "read";
  }
}

@Controller("intercepted")
@UseInterceptors(MarkingInterceptor)
class InterceptedController {
  @Get()
  read(): string {
    return calls.join(",");
  }
}

@Controller("filtered")
@UseFilters(OriginalFilter)
class FilteredController {
  @Get()
  read(): string {
    throw new Error("handler failure");
  }
}

@Controller("piped")
@UsePipes(UpperPipe)
class PipedController {
  @Get(":name")
  read(@Param("name") name: string): string {
    return name;
  }
}

@Controller("parameter-piped")
class ParameterPipedController {
  @Get(":name")
  read(@Param("name", UpperPipe) name: string): string {
    return name;
  }
}

@Controller("instance-piped")
class InstancePipedController {
  @Get(":name")
  read(@Param("name", new LiteralPipe()) name: string): string {
    return name;
  }
}

@Module({
  controllers: [
    GuardedController,
    InterceptedController,
    FilteredController,
    PipedController,
    ParameterPipedController,
    InstancePipedController,
  ],
  providers: [RefusingGuard, MarkingInterceptor, OriginalFilter, UpperPipe],
})
class EnhancerModule {}

test("overrideGuard lets a refused route answer", async () => {
  const refusing = await createTestApplication(EnhancerModule).compile();
  expect((await refusing.handle(new Request("http://localhost/guarded"))).status).toBe(403);
  await refusing.close();

  const application = await createTestApplication(EnhancerModule)
    .overrideGuard(RefusingGuard)
    .useValue({ canActivate: () => true })
    .compile();

  expect(await (await application.handle(new Request("http://localhost/guarded"))).text()).toBe(
    "read",
  );
  await application.close();
});

test("overrideInterceptor replaces the instance a route already declared", async () => {
  calls.length = 0;
  const application = await createTestApplication(EnhancerModule)
    .overrideInterceptor(MarkingInterceptor)
    .useValue({ interceptBefore: () => calls.push("stub") })
    .compile();

  const response = await application.handle(new Request("http://localhost/intercepted"));

  expect(await response.text()).toBe("stub");
  await application.close();
});

test("overrideFilter answers with the substitute", async () => {
  const application = await createTestApplication(EnhancerModule)
    .overrideFilter(OriginalFilter)
    .useValue({ catch: () => new Response("replaced", { status: 418 }) })
    .compile();

  const response = await application.handle(new Request("http://localhost/filtered"));

  expect(response.status).toBe(418);
  expect(await response.text()).toBe("replaced");
  await application.close();
});

test("overridePipe substitutes a route-level pipe class", async () => {
  const application = await createTestApplication(EnhancerModule)
    .overridePipe(UpperPipe)
    .useValue({ transform: (value: unknown) => `piped:${String(value)}` })
    .compile();

  const response = await application.handle(new Request("http://localhost/piped/ada"));

  expect(await response.text()).toBe("piped:ada");
  await application.close();
});

test("refuses a route-level pipe override only the container could resolve", async () => {
  const failure = await createTestApplication(EnhancerModule)
    .overridePipe(UpperPipe)
    .useFactory(() => ({ transform: (value: unknown) => value }))
    .compile()
    .then(
      () => undefined,
      (error: unknown) => error,
    );

  expect(failure).toMatchObject({ code: "INVALID_PIPE" });
});

test("overridePipe substitutes a pipe declared on one parameter", async () => {
  const application = await createTestApplication(EnhancerModule)
    .overridePipe(UpperPipe)
    .useValue({ transform: (value: unknown) => `parameter:${String(value)}` })
    .compile();

  const response = await application.handle(new Request("http://localhost/parameter-piped/ada"));

  expect(await response.text()).toBe("parameter:ada");
  await application.close();
});

test("overridePipe substitutes a class entry with another class", async () => {
  class PrefixedPipe implements PipeTransform {
    transform(value: unknown): unknown {
      return `class:${String(value)}`;
    }
  }

  const application = await createTestApplication(EnhancerModule)
    .overridePipe(UpperPipe)
    .useClass(PrefixedPipe)
    .compile();

  const response = await application.handle(new Request("http://localhost/piped/ada"));

  expect(await response.text()).toBe("class:ada");
  await application.close();
});

test("an instance pipe in a route plan is left as the application declared it", async () => {
  const application = await createTestApplication(EnhancerModule).compile();

  const response = await application.handle(new Request("http://localhost/instance-piped/ada"));

  expect(await response.text()).toBe("literal:ada");
  await application.close();
});

test("an override leaves a controller that carries no compiled plan untouched", async () => {
  const VALUE = createToken<string>("legacy.value");
  const legacyController = defineController(class LegacyController {}, {
    inject: [] as const,
    registerRoutes: (application) => application.get("/legacy", () => "legacy"),
  });

  const legacyModule = defineModule({
    id: "LegacyModule",
    controllers: [legacyController],
    providers: [provideValue(VALUE, "original")],
  });

  const application = await createTestApplication(legacyModule)
    .overrideProvider(VALUE)
    .useValue("overridden")
    .compile();

  const response = await application.handle(new Request("http://localhost/legacy"));

  expect(await response.text()).toBe("legacy");
  await application.close();
});
