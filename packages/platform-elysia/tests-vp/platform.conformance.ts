import {
  Body,
  Controller,
  Ctx,
  Get,
  Param,
  Res,
  Injectable,
  Module,
  Post,
  Query,
  defineModule,
  type ControllerDefinition,
  type RouteContext,
  type RouteResponseSettings,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import { z } from "zod";
import {
  AponiaFactory,
  ElysiaPluginModule,
  compileRootModule,
  defineElysiaController,
  defineElysiaPlugin,
  type ConfiguredAponiaApplicationOptions,
  type ElysiaRouteContext,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Injectable()
class HealthService {
  getStatus(): string {
    return "ok";
  }
}

@Controller("health")
class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getStatus(): string {
    return this.healthService.getStatus();
  }
}

@Module({
  providers: [HealthService],
  exports: [HealthService],
})
class HealthServicesModule {}

@Module({
  imports: [HealthServicesModule],
  controllers: [HealthController],
})
class HealthModule {}

@Controller("ambiguous-promise")
class AmbiguousPromiseController {
  @Get()
  read(): unknown {
    return Promise.resolve("resolved");
  }
}

@Module({ controllers: [AmbiguousPromiseController] })
class AmbiguousPromiseModule {}

class RegisteredHealthController {
  read(): string {
    return "registered";
  }
}

const registeredHealthController = defineElysiaController(RegisteredHealthController, {
  inject: [] as const,
  path: "/registered-health",
  registerRoutes: (application, controller) => {
    application.get("/registered-health", () => controller.read());
  },
});
const registeredHealthModule = defineModule({
  id: "RegisteredHealthModule",
  controllers: [registeredHealthController],
});

@Module({
  imports: [
    HealthServicesModule,
    ElysiaPluginModule.registerAsync({
      imports: [HealthServicesModule],
      inject: [HealthService] as const,
      useFactory: (healthService) =>
        new Elysia().get("/native-health", () => healthService.getStatus()),
    }),
  ],
  controllers: [HealthController],
})
class NativeHealthModule {}

function configureNative(nativeApplication: Elysia) {
  return nativeApplication.state("aponiaVersion", "typed" as const);
}

test("the Vite+ lane mounts a controller from module metadata", async () => {
  const options: ConfiguredAponiaApplicationOptions<ReturnType<typeof configureNative>> = {
    logger: false,
    elysia: {
      aot: true,
      precompile: {
        compose: true,
        schema: true,
      },
    },
    configureNative,
  };
  const application = await AponiaFactory.create(HealthModule, options);
  const response = await application.handle(new Request("http://localhost/health"));
  const healthRoute = application
    .getNativeApplication()
    .compile()
    .router.history.find((route) => route.path === "/health");
  const healthHandlerSource = healthRoute?.handler.toString() ?? "";
  const compiledHealthRoute = healthRoute?.compile().toString();

  expect(await response.text()).toBe("ok");
  expect(application.getNativeApplication().store.aponiaVersion).toBe("typed");
  expect(application.getNativeApplication().config.aot).toBe(true);
  expect(application.getNativeApplication().config.precompile).toEqual({
    compose: true,
    schema: true,
  });
  expect(healthHandlerSource.startsWith("()=>")).toBe(true);
  expect(compiledHealthRoute).not.toContain("await handler(c)");
  await application.close();
});

test("the Vite+ lane supports explicit dynamic Elysia composition", async () => {
  const application = await AponiaFactory.create(HealthModule, {
    logger: false,
    elysia: {
      aot: false,
      precompile: false,
    },
  });
  const response = await application.handle(new Request("http://localhost/health"));

  expect(application.getNativeApplication().config.aot).toBe(false);
  expect(await response.text()).toBe("ok");
  await application.close();
});

test("the Vite+ lane awaits ambiguous Promise results before after-handle hooks", async () => {
  let observedResponse: unknown;
  const application = await AponiaFactory.create(AmbiguousPromiseModule, {
    logger: false,
    configureNative: (nativeApplication) =>
      nativeApplication.onAfterHandle(({ response }) => {
        observedResponse = response;
      }),
  });
  const nativeApplication = application.getNativeApplication().compile();
  const compiledRoute = nativeApplication.router.history
    .find((route) => route.path === "/ambiguous-promise")
    ?.compile()
    .toString();
  const response = await application.handle(new Request("http://localhost/ambiguous-promise"));

  expect(await response.text()).toBe("resolved");
  expect(observedResponse).toBe("resolved");
  expect(observedResponse).not.toBeInstanceOf(Promise);
  expect(compiledRoute).toContain("await handler(c)");
  await application.close();
});

test("the Vite+ lane mounts a directly registered controller descriptor", async () => {
  const application = await AponiaFactory.create(registeredHealthModule, {
    logger: false,
  });
  const response = await application.handle(new Request("http://localhost/registered-health"));

  expect(await response.text()).toBe("registered");
  await application.close();
});

test("the Vite+ lane resolves native plugin factories from module imports", async () => {
  const application = await AponiaFactory.create(NativeHealthModule, {
    logger: false,
  });
  const response = await application.handle(new Request("http://localhost/native-health"));

  expect(await response.text()).toBe("ok");
  await application.close();
});

test("the Vite+ lane classifies a non-Elysia controller result as invalid", async () => {
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

test("the Vite+ lane rejects missing decorator metadata", async () => {
  class UndecoratedModule {}
  const moduleError = await AponiaFactory.create(UndecoratedModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  class UndecoratedController {}
  class InvalidControllerModule {}
  Module({ controllers: [UndecoratedController] })(InvalidControllerModule);
  const controllerError = await AponiaFactory.create(InvalidControllerModule, {
    logger: false,
  }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(moduleError).toEqual(expect.objectContaining({ code: "INVALID_MODULE" }));
  expect(controllerError).toEqual(expect.objectContaining({ code: "INVALID_CONTROLLER" }));
});

test("the Vite+ lane rejects static module cycles and reuses repeated imports", () => {
  class FirstModule {}
  class SecondModule {}
  Module({ imports: [SecondModule] })(FirstModule);
  Module({ imports: [FirstModule] })(SecondModule);

  expect(() => compileRootModule(FirstModule)).toThrow(
    expect.objectContaining({ code: "MODULE_CYCLE" }),
  );

  class SharedModule {}
  class RootModule {}
  const descriptor = defineModule({ id: "DescriptorImport" });
  Module({})(SharedModule);
  Module({ imports: [descriptor, SharedModule, SharedModule] })(RootModule);

  const compiled = compileRootModule(RootModule);
  expect(compiled.imports[0]).toBe(descriptor);
  expect(compiled.imports[1]).toBe(compiled.imports[2]);
});

test("the Vite+ lane rejects foreign controller descriptors", async () => {
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

  expect(error).toEqual(expect.objectContaining({ code: "UNSUPPORTED_CONTROLLER" }));
});

const createUserSchema = {
  body: z.object({
    name: z.string().min(2),
  }),
};

@Controller("conformance-users")
class ConformanceUserController {
  @Post("/", createUserSchema)
  createUser(context: RouteContext<typeof createUserSchema>): { name: string } {
    return { name: context.body.name };
  }
}

@Module({
  controllers: [ConformanceUserController],
})
class ConformanceUserModule {}

test("the Vite+ lane validates route input with a Standard Schema validator", async () => {
  const application = await AponiaFactory.create(ConformanceUserModule, { logger: false });
  const accepted = await application.handle(
    new Request("http://localhost/conformance-users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );
  const rejected = await application.handle(
    new Request("http://localhost/conformance-users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A" }),
    }),
  );

  expect(await accepted.json()).toEqual({ name: "Ada" });
  expect(rejected.status).toBe(422);
  await application.close();
});

const conformanceParameterSchema = { body: z.object({ name: z.string().min(2) }) };

@Controller("conformance-parameters")
class ConformanceParameterController {
  @Post("/", conformanceParameterSchema)
  createUser(
    @Body() body: { name: string },
    @Res() set: RouteResponseSettings,
  ): {
    name: string;
  } {
    set.headers["x-source"] = "parameters";
    return { name: body.name };
  }

  @Get(":id")
  findUser(@Param("id") id: string): { id: string } {
    return { id };
  }

  @Get("async/:id")
  async findUserAsync(
    @Param("id") id: string,
    _unused: unknown,
    @Query("name") name: string | undefined,
  ): Promise<{ id: string; name: string | undefined; unused: boolean }> {
    return { id, name, unused: _unused === undefined };
  }

  @Post("escaped")
  selectEscapedBodyProperty(@Body('quoted"key') value: string): { value: string } {
    return { value };
  }
}

@Module({
  controllers: [ConformanceParameterController],
})
class ConformanceParameterModule {}

test("the Vite+ lane injects decorated route parameters", async () => {
  const application = await AponiaFactory.create(ConformanceParameterModule, { logger: false });
  const created = await application.handle(
    new Request("http://localhost/conformance-parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );
  const rejected = await application.handle(
    new Request("http://localhost/conformance-parameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A" }),
    }),
  );
  const found = await application.handle(new Request("http://localhost/conformance-parameters/42"));
  const foundAsync = await application.handle(
    new Request("http://localhost/conformance-parameters/async/42?name=Ada"),
  );
  const escaped = await application.handle(
    new Request("http://localhost/conformance-parameters/escaped", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 'quoted"key': "value" }),
    }),
  );
  const asyncRouteSource = application
    .getNativeApplication()
    .compile()
    .router.history.find((route) => route.path === "/conformance-parameters/async/:id")
    ?.compile()
    .toString();

  expect(created.headers.get("x-source")).toBe("parameters");
  expect(await created.json()).toEqual({ name: "Ada" });
  expect(rejected.status).toBe(422);
  expect(await found.json()).toEqual({ id: "42" });
  expect(await foundAsync.json()).toEqual({
    id: "42",
    name: "Ada",
    unused: true,
  });
  expect(await escaped.json()).toEqual({ value: "value" });
  expect(asyncRouteSource).toContain("await handler(c)");
  await application.close();
});

const conformanceClockPlugin = new Elysia({ name: "conformance-clock" })
  .decorate("now", () => "2026-07-28T00:00:00.000Z")
  .state("requests", 0)
  .derive({ as: "global" }, () => ({ traceId: "trace-1" }))
  .derive(() => ({ pluginOnly: "local" }));

@Controller("conformance-plugin-context")
class ConformancePluginContextController {
  @Get()
  read(@Ctx() context: ElysiaRouteContext<{}, typeof conformanceClockPlugin>): {
    now: string;
    traceId: string;
    requests: number;
    pluginOnly: unknown;
  } {
    context.store.requests += 1;
    return {
      now: context.now(),
      traceId: context.traceId,
      requests: context.store.requests,
      pluginOnly: (context as Record<string, unknown>).pluginOnly ?? null,
    };
  }
}

@Module({
  imports: [ElysiaPluginModule.register(conformanceClockPlugin, { key: "conformance-clock" })],
  controllers: [ConformancePluginContextController],
})
class ConformancePluginContextModule {}

test("the Vite+ lane types and exposes native plugin context", async () => {
  const application = await AponiaFactory.create(ConformancePluginContextModule, { logger: false });
  const response = await application.handle(
    new Request("http://localhost/conformance-plugin-context"),
  );

  expect(await response.json()).toEqual({
    now: "2026-07-28T00:00:00.000Z",
    traceId: "trace-1",
    requests: 1,
    pluginOnly: null,
  });
  await application.close();
});

const conformanceCachePlugin = defineElysiaPlugin(
  new Elysia({ name: "conformance-cache" }).decorate("cache", {
    read: (key: string) => `cached:${key}`,
  }),
  { key: "conformance-cache" },
);
type conformanceCachePlugin = typeof conformanceCachePlugin;

@Controller("conformance-defined-plugin")
class ConformanceDefinedPluginController {
  @Get()
  read(@Ctx() context: ElysiaRouteContext<conformanceCachePlugin>): { cached: string } {
    return { cached: context.cache.read("users") };
  }
}

@Module({
  imports: [conformanceCachePlugin],
  controllers: [ConformanceDefinedPluginController],
})
class ConformanceDefinedPluginModule {}

test("the Vite+ lane mounts and types a defined native plugin", async () => {
  const application = await AponiaFactory.create(ConformanceDefinedPluginModule, { logger: false });
  const response = await application.handle(
    new Request("http://localhost/conformance-defined-plugin"),
  );

  expect(await response.json()).toEqual({ cached: "cached:users" });
  await application.close();
});
