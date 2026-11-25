import { expect, test } from "bun:test";
import {
  ConfigurableModuleBuilder,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  provideClass,
} from "@aponiajs/common";
import { AponiaFactory } from "./index.ts";

interface GreetingOptions {
  readonly prefix: string;
}

test("a generated configurable module injects its options at boot", async () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<GreetingOptions>().setClassMethodName("forRoot").build();

  @Injectable()
  class GreetingService {
    constructor(@Inject(MODULE_OPTIONS_TOKEN) readonly options: GreetingOptions) {}

    greet(name: string): string {
      return `${this.options.prefix} ${name}`;
    }
  }

  @Controller("greet")
  class GreetController {
    constructor(private readonly service: GreetingService) {}

    @Get()
    read(): string {
      return this.service.greet("ada");
    }
  }

  @Module({ controllers: [GreetController], providers: [GreetingService] })
  class GreetingModule extends ConfigurableModuleClass {}

  @Module({ imports: [GreetingModule.forRoot({ prefix: "hello" })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/greet"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello ada");
  } finally {
    await application.close();
  }
});

test("an asynchronous factory is awaited before the application boots", async () => {
  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<GreetingOptions>().setClassMethodName("forRoot").build();

  @Injectable()
  class GreetingService {
    constructor(@Inject(MODULE_OPTIONS_TOKEN) readonly options: GreetingOptions) {}
  }

  @Module({ providers: [GreetingService], exports: [GreetingService] })
  class GreetingModule extends ConfigurableModuleClass {}

  @Module({
    imports: [GreetingModule.forRootAsync({ useFactory: async () => ({ prefix: "async" }) })],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const service = application.get(GreetingService) as GreetingService;
    expect(service.options).toEqual({ prefix: "async" });
  } finally {
    await application.close();
  }
});

test("an asynchronous options factory class is awaited before the application boots", async () => {
  class OptionsFactory {
    async create(): Promise<GreetingOptions> {
      return { prefix: "from-class" };
    }
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<GreetingOptions>().build();

  @Injectable()
  class GreetingService {
    constructor(@Inject(MODULE_OPTIONS_TOKEN) readonly options: GreetingOptions) {}
  }

  @Module({ providers: [GreetingService], exports: [GreetingService] })
  class GreetingModule extends ConfigurableModuleClass {}

  @Module({ imports: [GreetingModule.registerAsync({ useClass: OptionsFactory })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const service = application.get(GreetingService) as GreetingService;
    expect(service.options).toEqual({ prefix: "from-class" });
  } finally {
    await application.close();
  }
});

test("setExtras makes a generated registration global", async () => {
  interface GreetingOptions {
    readonly prefix: string;
    readonly isGlobal?: boolean;
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = new ConfigurableModuleBuilder<
    GreetingOptions,
    "forRoot",
    "create",
    { readonly isGlobal: boolean }
  >()
    .setClassMethodName("forRoot")
    .setExtras({ isGlobal: false }, (definition, extras) => ({
      ...definition,
      global: extras.isGlobal,
    }))
    .build();

  @Injectable()
  class GreetingService {
    constructor(@Inject(MODULE_OPTIONS_TOKEN) readonly options: GreetingOptions) {}
  }

  @Module({ providers: [GreetingService], exports: [GreetingService] })
  class GreetingModule extends ConfigurableModuleClass {}

  @Controller("global-greeting")
  class ConsumerController {
    constructor(private readonly service: GreetingService) {}

    @Get()
    read(): string {
      return this.service.options.prefix;
    }
  }

  @Module({ controllers: [ConsumerController] })
  class ConsumerModule {}

  @Module({
    imports: [GreetingModule.forRoot({ prefix: "global", isGlobal: true }), ConsumerModule],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/global-greeting"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("global");
  } finally {
    await application.close();
  }
});

test("an asynchronous registration follows an existing options factory provider", async () => {
  interface GreetingOptions {
    readonly prefix: string;
  }

  class OptionsStore {
    create(): GreetingOptions {
      return { prefix: "existing" };
    }
  }

  @Module({ providers: [provideClass(OptionsStore, [])], exports: [OptionsStore] })
  class StoreModule {}

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<GreetingOptions>().setClassMethodName("forRoot").build();

  @Injectable()
  class GreetingService {
    constructor(@Inject(MODULE_OPTIONS_TOKEN) readonly options: GreetingOptions) {}
  }

  @Module({ providers: [GreetingService], exports: [GreetingService] })
  class GreetingModule extends ConfigurableModuleClass {}

  @Module({
    imports: [
      GreetingModule.forRootAsync({
        imports: [StoreModule],
        useExisting: OptionsStore,
      }),
    ],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    expect(application.get(GreetingService).options).toEqual({ prefix: "existing" });
  } finally {
    await application.close();
  }
});

test("two synchronous registrations of one configurable module stay isolated", () => {
  interface GreetingOptions {
    readonly prefix: string;
  }

  const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
    new ConfigurableModuleBuilder<GreetingOptions>().setClassMethodName("forRoot").build();

  @Module({})
  class GreetingModule extends ConfigurableModuleClass {}

  const first = GreetingModule.forRoot({ prefix: "one" });
  const second = GreetingModule.forRoot({ prefix: "two" });

  expect(first.module).toBe(GreetingModule);
  expect(second.module).toBe(GreetingModule);
  expect(first.instanceId).not.toBe(second.instanceId);
  expect(first.providers?.[0]).toEqual(
    expect.objectContaining({ provide: MODULE_OPTIONS_TOKEN, useValue: { prefix: "one" } }),
  );
});
