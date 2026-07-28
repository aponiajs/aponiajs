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
  type RouteContext,
  type RouteResponseSettings,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import { z } from "zod";
import {
  AponiaFactory,
  ElysiaPluginModule,
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
    configureNative,
  };
  const application = await AponiaFactory.create(HealthModule, options);
  const response = await application.handle(new Request("http://localhost/health"));

  expect(await response.text()).toBe("ok");
  expect(application.getNativeApplication().store.aponiaVersion).toBe("typed");
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

  expect(created.headers.get("x-source")).toBe("parameters");
  expect(await created.json()).toEqual({ name: "Ada" });
  expect(rejected.status).toBe(422);
  expect(await found.json()).toEqual({ id: "42" });
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
