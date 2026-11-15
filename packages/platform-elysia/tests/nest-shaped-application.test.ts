import { expect, test } from "bun:test";
import {
  APP_GUARD,
  APP_PIPE,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  Scope,
  createToken,
  dynamicModule,
  Body,
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";
import { RequestContextModule } from "../src/request-context/request-context-module.ts";
import { RequestContextService } from "../src/request-context/request-context.service.ts";

/**
 * A Nest-shaped application, written the way a migrating project writes one:
 * dynamic `forRoot` registration, provider literals, a global module, a barrel
 * module re-exporting what it imports, application-level tokens, decorators,
 * a request-scoped service, and lifecycle hooks. Nothing here is Aponia-only
 * except `dynamicModule()`, which supplies the two identity fields Nest does not
 * have.
 */

const CONFIG = createToken<{ readonly greeting: string }>("NEST_CONFIG");
const CLOCK = createToken<{ readonly now: () => string }>("NEST_CLOCK");
const CLOCK_ALIAS = createToken<{ readonly now: () => string }>("NEST_CLOCK_ALIAS");
const GREETING = createToken<string>("NEST_GREETING");

@Module({})
class ConfigModule {
  static forRoot(greeting: string): DynamicModule {
    return dynamicModule({
      module: ConfigModule,
      global: true,
      providers: [
        { provide: CONFIG, useValue: Object.freeze({ greeting }) },
        { provide: CLOCK, useValue: Object.freeze({ now: () => "12:00" }) },
        { provide: CLOCK_ALIAS, useExisting: CLOCK },
        {
          provide: GREETING,
          useFactory: (config: { readonly greeting: string }) => config.greeting.toUpperCase(),
          inject: [CONFIG],
        },
      ],
      exports: [CONFIG, CLOCK, CLOCK_ALIAS, GREETING],
    });
  }
}

const bootCalls: string[] = [];

@Injectable()
class UsersRepository {
  constructor(@Inject(CONFIG) readonly config: { readonly greeting: string }) {}

  greet(): string {
    return this.config.greeting;
  }
}

@Module({ providers: [UsersRepository], exports: [UsersRepository] })
class UsersModule {
  onModuleInit(): void {
    bootCalls.push("UsersModule");
  }
}

@Module({ imports: [UsersModule], exports: [UsersModule] })
class DataModule {}

@Injectable()
class ApplicationUserId implements PipeTransform {
  transform(value: unknown): unknown {
    return typeof value === "string" ? `user:${value}` : value;
  }
}

@Injectable()
class RequireUser implements CanActivate {
  canActivate(execution: ExecutionContext): boolean {
    return execution.getClass() !== undefined;
  }
}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedGreeting {
  constructor(
    private readonly context: RequestContextService,
    private readonly repository: UsersRepository,
  ) {}

  describe(): string {
    return `${this.repository.greet()}:${this.context.current()?.requestId}`;
  }
}

@Controller("users")
class UsersController {
  constructor(
    private readonly scoped: RequestScopedGreeting,
    @Inject(CLOCK_ALIAS) private readonly clock: { readonly now: () => string },
  ) {}

  @Get()
  read(): string {
    return `${this.scoped.describe()}@${this.clock.now()}`;
  }

  @Post("named")
  named(@Body("name") name: string): string {
    return name;
  }
}

@Module({
  imports: [ConfigModule.forRoot("hello"), DataModule, RequestContextModule.forRoot()],
  controllers: [UsersController],
  providers: [
    RequestScopedGreeting,
    RequireUser,
    ApplicationUserId,
    { provide: APP_GUARD, useValue: RequireUser },
    { provide: APP_PIPE, useValue: [ApplicationUserId] },
  ],
})
class NestShapedAppModule {}

test("boots a Nest-shaped application and answers through it", async () => {
  bootCalls.length = 0;
  const application = await AponiaFactory.create(NestShapedAppModule, { logger: false });

  const first = await application.handle(
    new Request("http://localhost/users", { headers: { "x-request-id": "one" } }),
  );
  const second = await application.handle(
    new Request("http://localhost/users", { headers: { "x-request-id": "two" } }),
  );

  expect(await first.text()).toBe("hello:one@12:00");
  expect(await second.text()).toBe("hello:two@12:00");
  expect(bootCalls).toEqual(["UsersModule"]);

  await application.close();
});

test("applies an application-level pipe to a request body", async () => {
  const application = await AponiaFactory.create(NestShapedAppModule, { logger: false });

  const response = await application.handle(
    new Request("http://localhost/users/named", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ada" }),
    }),
  );

  expect(await response.text()).toBe("user:ada");
  await application.close();
});
