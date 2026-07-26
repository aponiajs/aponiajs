import { expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, type LoggerService } from "@aponiajs/common";
import { Elysia } from "elysia";
import { AponiaFactory, ElysiaPluginModule } from "../src/index.ts";

class MemoryLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}

  error(): void {}

  warn(): void {}
}

@Injectable()
class MessageService {
  getMessage(): string {
    return "Hello from service";
  }
}

@Controller("messages")
class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Get()
  getMessage(): string {
    return this.messageService.getMessage();
  }
}

@Module({
  providers: [MessageService],
  exports: [MessageService],
})
class MessageServicesModule {}

@Module({
  imports: [MessageServicesModule],
  controllers: [MessageController],
})
class MessageModule {}

const modulePluginEvents: string[] = [];
let asyncPluginFactoryCalls = 0;
let sharedPluginRegistrations = 0;

@Injectable()
class NativePluginConfig {
  readonly route = "/native-from-service";
}

@Module({
  providers: [NativePluginConfig],
  exports: [NativePluginConfig],
})
class NativePluginConfigModule {}

const sharedPluginModule = ElysiaPluginModule.register((nativeApplication: Elysia) => {
  sharedPluginRegistrations += 1;
  return nativeApplication.get("/native-shared", () => "shared");
});

@Module({
  imports: [sharedPluginModule],
})
class LeftPluginFeatureModule {}

@Module({
  imports: [sharedPluginModule],
})
class RightPluginFeatureModule {}

@Module({
  imports: [
    MessageServicesModule,
    ElysiaPluginModule.register(
      new Elysia().get("/native-module-instance", () => "module-instance"),
    ),
    ElysiaPluginModule.register([new Elysia().get("/native-module-array", () => "module-array")]),
    ElysiaPluginModule.register(
      Promise.resolve({
        default: (nativeApplication: Elysia) =>
          nativeApplication.get("/native-module-lazy", () => "module-lazy"),
      }),
    ),
    ElysiaPluginModule.register((nativeApplication: Elysia) =>
      nativeApplication.onRequest(() => {
        modulePluginEvents.push("first");
      }),
    ),
    ElysiaPluginModule.register((nativeApplication: Elysia) =>
      nativeApplication.onRequest(() => {
        modulePluginEvents.push("second");
      }),
    ),
    ElysiaPluginModule.registerAsync({
      imports: [NativePluginConfigModule],
      inject: [NativePluginConfig] as const,
      useFactory: async (configuration) => {
        asyncPluginFactoryCalls += 1;
        return new Elysia().get(configuration.route, () => "module-service");
      },
    }),
    LeftPluginFeatureModule,
    RightPluginFeatureModule,
  ],
  controllers: [MessageController],
})
class NativePluginImportsModule {}

test("imports modules and injects their exported services into controllers", async () => {
  const logger = new MemoryLogger();
  const application = await AponiaFactory.create(MessageModule, { logger });
  const response = await application.handle(new Request("http://localhost/messages"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello from service");
  expect(() => application.getUrl()).toThrow(
    "app.listen() needs to be called before calling app.getUrl().",
  );
  expect(logger.records).toEqual([
    {
      context: "AponiaFactory",
      message: "Starting Aponia application...",
    },
    {
      context: "InstanceLoader",
      message: "MessageServicesModule dependencies initialized",
    },
    {
      context: "InstanceLoader",
      message: "MessageModule dependencies initialized",
    },
    {
      context: "RoutesResolver",
      message: "MessageController {/messages}:",
    },
    {
      context: "RouterExplorer",
      message: "Mapped {/messages, GET} route",
    },
  ]);
  await application.close();
});

test("composes existing Elysia plugins before Aponia controllers", async () => {
  const events: string[] = [];
  let registrations = 0;
  const instancePlugin = new Elysia().get("/native-instance", () => "instance");
  const arrayPlugins = [
    new Elysia().get("/native-array-first", () => "array-first"),
    new Elysia().get("/native-array-second", () => "array-second"),
  ];
  const promisedInstance = Promise.resolve(new Elysia().get("/native-promise", () => "promise"));
  const functionalPlugin = (application: Elysia) =>
    application
      .onRequest(() => {
        events.push("first");
      })
      .get("/native-function", () => "function");
  const secondPlugin = (application: Elysia) =>
    application.onRequest(() => {
      events.push("second");
    });
  const lazyPlugin = Promise.resolve({
    default: (application: Elysia) => application.get("/native-lazy", () => "lazy"),
  });
  const asyncPlugin = async (application: Elysia) => {
    registrations += 1;
    return application.get("/native-async", () => "async");
  };

  const application = await AponiaFactory.create(MessageModule, {
    logger: false,
    configureNative: (nativeApplication) =>
      nativeApplication
        .use(instancePlugin)
        .use(arrayPlugins)
        .use(promisedInstance)
        .use(functionalPlugin)
        .use(secondPlugin)
        .use(lazyPlugin)
        .use(asyncPlugin),
  });

  const instanceResponse = await application.handle(
    new Request("http://localhost/native-instance"),
  );
  const functionResponse = await application.handle(
    new Request("http://localhost/native-function"),
  );
  const lazyResponse = await application.handle(new Request("http://localhost/native-lazy"));
  const arrayResponse = await application.handle(
    new Request("http://localhost/native-array-second"),
  );
  const promiseResponse = await application.handle(new Request("http://localhost/native-promise"));
  const asyncResponse = await application.handle(new Request("http://localhost/native-async"));
  const controllerResponse = await application.handle(new Request("http://localhost/messages"));

  expect(await instanceResponse.text()).toBe("instance");
  expect(await functionResponse.text()).toBe("function");
  expect(await lazyResponse.text()).toBe("lazy");
  expect(await arrayResponse.text()).toBe("array-second");
  expect(await promiseResponse.text()).toBe("promise");
  expect(await asyncResponse.text()).toBe("async");
  expect(await controllerResponse.text()).toBe("Hello from service");
  expect(registrations).toBe(1);
  expect(events).toEqual([
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
  ]);
  await application.close();
});

test("rejects a native configurator that replaces the application", async () => {
  const error = await AponiaFactory.create(MessageModule, {
    logger: false,
    configureNative: () => new Elysia(),
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_NATIVE_APPLICATION",
    }),
  );
});

test("loads unchanged Elysia plugins through Nest-style module imports", async () => {
  modulePluginEvents.length = 0;
  asyncPluginFactoryCalls = 0;
  sharedPluginRegistrations = 0;

  const application = await AponiaFactory.create(NativePluginImportsModule, {
    logger: false,
  });

  const instanceResponse = await application.handle(
    new Request("http://localhost/native-module-instance"),
  );
  const serviceResponse = await application.handle(
    new Request("http://localhost/native-from-service"),
  );
  const arrayResponse = await application.handle(
    new Request("http://localhost/native-module-array"),
  );
  const lazyResponse = await application.handle(new Request("http://localhost/native-module-lazy"));
  const sharedResponse = await application.handle(new Request("http://localhost/native-shared"));
  const controllerResponse = await application.handle(new Request("http://localhost/messages"));

  expect(await instanceResponse.text()).toBe("module-instance");
  expect(await serviceResponse.text()).toBe("module-service");
  expect(await arrayResponse.text()).toBe("module-array");
  expect(await lazyResponse.text()).toBe("module-lazy");
  expect(await sharedResponse.text()).toBe("shared");
  expect(await controllerResponse.text()).toBe("Hello from service");
  expect(asyncPluginFactoryCalls).toBe(1);
  expect(sharedPluginRegistrations).toBe(1);
  expect(modulePluginEvents).toEqual([
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
    "first",
    "second",
  ]);

  await application.close();
});
