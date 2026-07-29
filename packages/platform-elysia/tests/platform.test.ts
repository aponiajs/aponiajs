import { expect, spyOn, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  defineModule,
  type ControllerDefinition,
  type LoggerService,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import {
  AponiaElysiaApplication,
  AponiaFactory,
  ElysiaPluginModule,
  compileRootModule,
  defineElysiaController,
} from "../src/index.ts";

class MemoryLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];
  readonly errors: unknown[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}

  error(message: unknown): void {
    this.errors.push(message);
  }

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

let registeredControllerCalls = 0;
let pluginControllerCalls = 0;
const registeredApplicationNames: (string | undefined)[] = [];

class RegisteredDescriptorController {
  read(): string {
    return "registered";
  }
}

class PluginDescriptorController {
  read(): string {
    return "plugin";
  }
}

const registeredDescriptorController = defineElysiaController(RegisteredDescriptorController, {
  inject: [] as const,
  path: "/descriptor-registered",
  registerRoutes: (application, controller) => {
    registeredControllerCalls += 1;
    registeredApplicationNames.push(application.config.name);
    application.get("/descriptor-registered", () => controller.read());
  },
});
const pluginDescriptorController = defineElysiaController(PluginDescriptorController, {
  inject: [] as const,
  buildPlugin: (controller) => {
    pluginControllerCalls += 1;
    return new Elysia().get("/descriptor-plugin", () => controller.read());
  },
});
const descriptorControllerModule = defineModule({
  id: "DescriptorControllerModule",
  controllers: [registeredDescriptorController, pluginDescriptorController],
});

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

test("rejects classes with missing module or controller metadata", async () => {
  class UndecoratedModule {}
  const moduleError = await AponiaFactory.create(UndecoratedModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  class UndecoratedDynamicModule {}
  const dynamicModuleError = await AponiaFactory.create(
    {
      module: UndecoratedDynamicModule,
      id: "UndecoratedDynamicModule",
      instanceId: Symbol("undecorated-dynamic-module"),
    },
    { logger: false },
  ).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  class UndecoratedController {}
  @Module({ controllers: [UndecoratedController] })
  class InvalidControllerModule {}
  const controllerError = await AponiaFactory.create(InvalidControllerModule, {
    logger: false,
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(moduleError).toEqual(
    expect.objectContaining({
      code: "INVALID_MODULE",
      details: { module: "UndecoratedModule" },
    }),
  );
  expect(dynamicModuleError).toEqual(
    expect.objectContaining({
      code: "INVALID_MODULE",
      details: { module: "UndecoratedDynamicModule" },
    }),
  );
  expect(controllerError).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
      details: { controller: "UndecoratedController" },
    }),
  );
});

test("rejects a cycle formed only from decorated module classes", () => {
  class FirstModule {}
  class SecondModule {}
  Module({ imports: [SecondModule] })(FirstModule);
  Module({ imports: [FirstModule] })(SecondModule);

  expect(() => compileRootModule(FirstModule)).toThrow(
    expect.objectContaining({
      code: "MODULE_CYCLE",
      details: { cycle: ["FirstModule", "SecondModule", "FirstModule"] },
    }),
  );
});

test("reuses compiled class imports and accepts nested descriptor modules", () => {
  const descriptor = defineModule({ id: "DescriptorImport" });

  @Module({
    imports: [descriptor, MessageServicesModule, MessageServicesModule],
  })
  class MixedImportsModule {}

  const compiled = compileRootModule(MixedImportsModule);

  expect(compiled.imports[0]).toBe(descriptor);
  expect(compiled.imports[1]).toBe(compiled.imports[2]);
});

test("rejects controller descriptors owned by another platform", async () => {
  class ForeignController {}
  const controller: ControllerDefinition = {
    kind: "foreign.controller",
    token: ForeignController,
    inject: [],
    useClass: ForeignController,
  };
  const module = defineModule({
    id: "ForeignControllerModule",
    controllers: [controller],
  });
  const error = await AponiaFactory.create(module, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "UNSUPPORTED_CONTROLLER",
      details: {
        module: "ForeignControllerModule",
        controller: "ForeignController",
      },
    }),
  );
});

test("accepts an empty default logger policy without emitting bootstrap output", async () => {
  const application = await AponiaFactory.create(MessageModule, { logger: [] });
  const response = await application.handle(new Request("http://localhost/messages"));

  expect(await response.text()).toBe("Hello from service");
  await application.close();
});

test.serial("logs and rethrows native listen failures", async () => {
  const nativeApplication = new Elysia();
  const logger = new MemoryLogger();
  const application = new AponiaElysiaApplication(nativeApplication, logger);
  const failure = new Error("listen failed");
  const listen = spyOn(nativeApplication, "listen").mockImplementation(() => {
    throw failure;
  });

  try {
    expect(application.listen(3_000)).rejects.toBe(failure);
    expect(logger.errors).toEqual([failure]);
  } finally {
    listen.mockRestore();
  }
});

test("passes explicit Elysia AOT and precompile policy to the root application", async () => {
  const precompile = Object.freeze({ compose: true, schema: true });
  const observedConfigurations: {
    readonly aot: boolean | undefined;
    readonly name: string | undefined;
    readonly precompile: unknown;
  }[] = [];

  const application = await AponiaFactory.create(MessageModule, {
    logger: false,
    elysia: {
      aot: true,
      // Runtime callers cannot replace the framework-owned application name.
      name: "IgnoredName",
      precompile,
    } as never,
    configureNative: (nativeApplication) => {
      observedConfigurations.push({
        aot: nativeApplication.config.aot,
        name: nativeApplication.config.name,
        precompile: nativeApplication.config.precompile,
      });
      return nativeApplication;
    },
  });
  const response = await application.handle(new Request("http://localhost/messages"));

  expect(observedConfigurations).toEqual([
    {
      aot: true,
      name: "MessageModule",
      precompile,
    },
  ]);
  expect(await response.text()).toBe("Hello from service");
  await application.close();
});

test("supports Elysia dynamic composition as an explicit compatibility policy", async () => {
  const application = await AponiaFactory.create(MessageModule, {
    logger: false,
    elysia: {
      aot: false,
      precompile: false,
    },
  });
  const response = await application.handle(new Request("http://localhost/messages"));

  expect(application.getNativeApplication().config.aot).toBe(false);
  expect(application.getNativeApplication().config.precompile).toBe(false);
  expect(await response.text()).toBe("Hello from service");
  await application.close();
});

test("mounts registered descriptors directly and preserves buildPlugin fallback", async () => {
  registeredControllerCalls = 0;
  pluginControllerCalls = 0;
  registeredApplicationNames.length = 0;
  const application = await AponiaFactory.create(descriptorControllerModule, {
    logger: false,
  });
  const registered = await application.handle(
    new Request("http://localhost/descriptor-registered"),
  );
  const plugin = await application.handle(new Request("http://localhost/descriptor-plugin"));

  expect(await registered.text()).toBe("registered");
  expect(await plugin.text()).toBe("plugin");
  expect(registeredControllerCalls).toBe(1);
  expect(pluginControllerCalls).toBe(1);
  expect(registeredApplicationNames).toEqual(["DescriptorControllerModule"]);
  expect(Object.isFrozen(registeredDescriptorController)).toBe(true);
  expect(Object.isFrozen(registeredDescriptorController.inject)).toBe(true);

  const fallback = registeredDescriptorController.buildPlugin(new RegisteredDescriptorController());
  const fallbackResponse = await fallback.handle(
    new Request("http://localhost/descriptor-registered"),
  );
  expect(await fallbackResponse.text()).toBe("registered");
  expect(registeredControllerCalls).toBe(2);
  await application.close();
});

test("retains the plugin fallback on a compiled decorated controller", async () => {
  const [controller] = compileRootModule(MessageModule)
    .controllers as readonly (ControllerDefinition & {
    readonly buildPlugin: (instance: unknown) => Elysia;
  })[];
  const plugin = controller?.buildPlugin(new MessageController(new MessageService()));
  const response = await plugin?.handle(new Request("http://localhost/messages"));

  expect(await response?.text()).toBe("Hello from service");
});

test("logs the root path for a directly registered controller with no routes", async () => {
  class EmptyController {}
  const controller = defineElysiaController(EmptyController, {
    inject: [] as const,
    registerRoutes: () => {},
  });
  const module = defineModule({
    id: "EmptyControllerModule",
    controllers: [controller],
  });
  const logger = new MemoryLogger();
  const application = await AponiaFactory.create(module, { logger });

  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message: "EmptyController {/}:",
  });
  await application.close();
});

test("classifies a controller factory with a non-Elysia result as invalid", async () => {
  const invalidModule = defineModule({
    id: "InvalidControllerModule",
    controllers: [
      {
        kind: "aponia.elysia.controller",
        token: class BrokenController {},
        inject: [],
        useClass: class BrokenController {},
        buildPlugin: () => ({}),
      } as never,
    ],
  });
  const error = await AponiaFactory.create(invalidModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "INVALID_CONTROLLER",
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
