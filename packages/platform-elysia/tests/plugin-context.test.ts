import { expect, test } from "bun:test";
import {
  Controller,
  Context,
  Get,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Post,
  ResponseSettings,
  State,
} from "@aponiajs/common";
import { Elysia } from "elysia";
import { z } from "zod";
import {
  AponiaFactory,
  PluginModule,
  type RouteInputSchema,
  type HandlerContext,
  type ElysiaResponseSettings,
  type ResponseStatus,
  type AppState,
} from "../src/index.ts";

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

let scopedDeriveCalls = 0;

const clockPlugin = new Elysia({ name: "clock" })
  .decorate("now", () => "2026-07-28T00:00:00.000Z")
  .state("requests", 0)
  .derive("global", () => ({ traceId: "trace-1" }))
  .derive("plugin", () => {
    scopedDeriveCalls += 1;
    return { requestScope: "scoped" };
  })
  .derive(() => ({ pluginOnly: "local" }))
  .derive("global", () => ({ tenant: "acme" }));

const cachePlugin = new Elysia({ name: "cache" }).decorate("cache", {
  read: (key: string) => `cached:${key}`,
});

@Injectable()
class SecretService {
  readonly secret = "s3cret";
}

const createUserSchema = { body: z.object({ name: z.string().min(2) }) };

/** The alias an application declares once for the plugins it always mounts. */
type ApplicationContext<TSchema extends RouteInputSchema = {}> = HandlerContext<
  TSchema,
  [typeof clockPlugin, typeof cachePlugin]
>;

@Controller("context")
class ContextController {
  @Get("decorator")
  readDecorator(@Context() context: HandlerContext<{}, typeof clockPlugin>): { now: string } {
    return { now: context.now() };
  }

  @Get("store")
  readStore(@Context() context: HandlerContext<{}, typeof clockPlugin>): { requests: number } {
    context.store.requests += 1;
    return { requests: context.store.requests };
  }

  @Get("derived")
  readDerived(@Context() context: HandlerContext<{}, typeof clockPlugin>): {
    traceId: string;
    requestScope: string;
    tenant: string;
  } {
    return {
      traceId: context.traceId,
      requestScope: context.requestScope,
      tenant: context.tenant,
    };
  }

  @Get("plugin-local")
  readPluginLocal(@Context() context: HandlerContext<{}, typeof clockPlugin>): {
    pluginOnly: unknown;
  } {
    return { pluginOnly: (context as Record<string, unknown>).pluginOnly ?? null };
  }

  @Get("many")
  readMany(@Context() context: HandlerContext<[typeof clockPlugin, typeof cachePlugin]>): {
    now: string;
    cached: string;
  } {
    return { now: context.now(), cached: context.cache.read("users") };
  }

  @Get("short")
  readShort(@Context() context: HandlerContext<typeof clockPlugin>): { now: string } {
    return { now: context.now() };
  }

  @Get("alias/:id")
  readThroughAlias(
    @Param("id") id: string,
    @Context() context: ApplicationContext,
  ): { id: string; now: string; cached: string } {
    return { id, now: context.now(), cached: context.cache.read(id) };
  }

  @Post("schema", createUserSchema)
  readSchemaAndPlugin(
    @Context() context: HandlerContext<typeof createUserSchema, typeof clockPlugin>,
  ): { name: string; traceId: string } {
    context.set.headers["x-clock"] = context.now();
    return { name: context.body.name, traceId: context.traceId };
  }

  @Get("untyped")
  readUntyped(@Context() context: HandlerContext): { now: unknown } {
    return { now: (context as Record<string, unknown>).now === undefined ? null : "present" };
  }

  @Get("parts")
  readNativeParts(
    @State() store: AppState<typeof clockPlugin>,
    @ResponseSettings() set: ElysiaResponseSettings,
    @HttpStatus() status: ResponseStatus,
  ): unknown {
    store.requests += 1;
    set.headers["x-context-source"] = "parts";
    return status(202, { requests: store.requests });
  }
}

@Module({
  imports: [
    PluginModule.register(clockPlugin, { key: "clock" }),
    PluginModule.register(cachePlugin, { key: "cache" }),
  ],
  controllers: [ContextController],
})
class ContextModule {}

async function get(path: string): Promise<Response> {
  const application = await AponiaFactory.create(ContextModule, { logger: false });
  return application.handle(new Request(`http://localhost${path}`));
}

test("exposes a plugin decorator to a controller handler", async () => {
  const response = await get("/context/decorator");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ now: "2026-07-28T00:00:00.000Z" });
});

test("exposes plugin state to a controller handler", async () => {
  const response = await get("/context/store");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ requests: 1 });
});

test("exposes global and plugin-scoped derives", async () => {
  const response = await get("/context/derived");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    traceId: "trace-1",
    requestScope: "scoped",
    tenant: "acme",
  });
});

test("keeps a plugin-local derive inside the plugin", async () => {
  const response = await get("/context/plugin-local");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ pluginOnly: null });
});

test("merges the context of several plugins", async () => {
  const response = await get("/context/many");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    now: "2026-07-28T00:00:00.000Z",
    cached: "cached:users",
  });
});

test("combines a route schema with plugin context", async () => {
  const application = await AponiaFactory.create(ContextModule, { logger: false });
  const response = await application.handle(
    new Request("http://localhost/context/schema", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("x-clock")).toBe("2026-07-28T00:00:00.000Z");
  expect(await response.json()).toEqual({ name: "Ada", traceId: "trace-1" });
});

test("rejects an invalid body before the plugin-typed handler runs", async () => {
  const application = await AponiaFactory.create(ContextModule, { logger: false });
  const response = await application.handle(
    new Request("http://localhost/context/schema", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A" }),
    }),
  );

  expect(response.status).toBe(422);
});

test("keeps plugin values available to a handler that does not name the plugin type", async () => {
  const response = await get("/context/untyped");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ now: "present" });
});

test("runs a scoped derive once per request, not once per mounted controller", async () => {
  scopedDeriveCalls = 0;
  await get("/context/derived");

  expect(scopedDeriveCalls).toBe(1);
});

test("resolves an asynchronously configured plugin against the container", async () => {
  @Controller("configured")
  class ConfiguredController {
    @Get()
    read(@Context() context: HandlerContext<{}, Elysia<"", "local", SecretSingleton>>): {
      secret: string;
    } {
      return { secret: context.secret };
    }
  }

  @Module({ providers: [SecretService], exports: [SecretService] })
  class SecretModule {}

  @Module({
    imports: [
      PluginModule.registerAsync({
        key: "secret",
        imports: [SecretModule],
        inject: [SecretService],
        useFactory: (service: SecretService) =>
          new Elysia({ name: "secret" }).decorate("secret", service.secret),
      }),
    ],
    controllers: [ConfiguredController],
  })
  class ConfiguredModule {}

  const application = await AponiaFactory.create(ConfiguredModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/configured"));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ secret: "s3cret" });
});

interface SecretSingleton {
  decorator: { secret: string };
  store: {};
  derive: {};
}

type ClockContext = HandlerContext<{}, typeof clockPlugin>;
type ManyContext = HandlerContext<[typeof clockPlugin, typeof cachePlugin]>;
type ShortContext = HandlerContext<typeof clockPlugin>;
type AliasedSchemaContext = ApplicationContext<typeof createUserSchema>;
type BareContext = HandlerContext;
type SchemaContext = HandlerContext<typeof createUserSchema, typeof clockPlugin>;

/**
 * Elysia keeps the literal types a plugin declares, so the context carries them
 * through unchanged. These assertions fail compilation — and therefore
 * `bun run check` — the moment the mapping loses or widens a plugin type.
 */
type PluginTypeAssertions = [
  Expect<Equals<ClockContext["now"], () => "2026-07-28T00:00:00.000Z">>,
  Expect<Equals<ClockContext["store"], { requests: number }>>,
  Expect<Equals<ClockContext["traceId"], "trace-1">>,
  Expect<Equals<ClockContext["requestScope"], "scoped">>,
  Expect<Equals<ClockContext["tenant"], "acme">>,
  Expect<Equals<"pluginOnly" extends keyof ClockContext ? true : false, false>>,
  Expect<Equals<"now" extends keyof BareContext ? true : false, false>>,
  Expect<Equals<"traceId" extends keyof BareContext ? true : false, false>>,
  Expect<Equals<BareContext["store"], {}>>,
  Expect<Equals<ManyContext["cache"], { read: (key: string) => string }>>,
  Expect<Equals<ManyContext["now"], () => "2026-07-28T00:00:00.000Z">>,
  Expect<Equals<"cache" extends keyof ClockContext ? true : false, false>>,
  Expect<Equals<SchemaContext["body"], { name: string }>>,
  Expect<Equals<SchemaContext["now"], () => "2026-07-28T00:00:00.000Z">>,
  Expect<Equals<ShortContext["now"], ClockContext["now"]>>,
  Expect<Equals<ShortContext["traceId"], "trace-1">>,
  Expect<Equals<ShortContext["body"], unknown>>,
  Expect<Equals<AliasedSchemaContext["body"], { name: string }>>,
  Expect<Equals<AliasedSchemaContext["cache"], ManyContext["cache"]>>,
  Expect<Equals<AppState<typeof clockPlugin>, ClockContext["store"]>>,
  Expect<Equals<ElysiaResponseSettings, ClockContext["set"]>>,
  Expect<Equals<ResponseStatus, ClockContext["status"]>>,
];

test("keeps the plugin context type assertions referenced", () => {
  const assertions: PluginTypeAssertions = Array.from(
    { length: 22 },
    () => true,
  ) as PluginTypeAssertions;

  expect(assertions).toHaveLength(22);
});

test("types plugins passed in the first argument", async () => {
  const response = await get("/context/short");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ now: "2026-07-28T00:00:00.000Z" });
});

test("serves a handler annotated with an application context alias", async () => {
  const response = await get("/context/alias/42");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    id: "42",
    now: "2026-07-28T00:00:00.000Z",
    cached: "cached:42",
  });
});

test("injects typed store, set, and status parts without materializing the whole context", async () => {
  const application = await AponiaFactory.create(ContextModule, { logger: false });
  const routeHandlerSource =
    application
      .getNativeApplication()
      .routes.find((route) => route.path === "/context/parts")
      ?.handler.toString() ?? "";
  const first = await application.handle(new Request("http://localhost/context/parts"));
  const second = await application.handle(new Request("http://localhost/context/parts"));

  expect(routeHandlerSource).toContain("context.store");
  expect(routeHandlerSource).toContain("context.set");
  expect(routeHandlerSource).toContain("context.status");
  expect(routeHandlerSource).not.toContain("handler.call(instance,context)");
  expect(first.status).toBe(202);
  expect(first.headers.get("x-context-source")).toBe("parts");
  expect(await first.json()).toEqual({ requests: 1 });
  expect(second.status).toBe(202);
  expect(await second.json()).toEqual({ requests: 2 });
  await application.close();
});
