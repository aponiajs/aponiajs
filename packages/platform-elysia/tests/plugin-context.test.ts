import { expect, test } from "bun:test";
import { Controller, Ctx, Get, Injectable, Module, Post } from "@aponiajs/common";
import { Elysia } from "elysia";
import { z } from "zod";
import { AponiaFactory, ElysiaPluginModule, type ElysiaRouteContext } from "../src/index.ts";

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

let scopedDeriveCalls = 0;

const clockPlugin = new Elysia({ name: "clock" })
  .decorate("now", () => "2026-07-28T00:00:00.000Z")
  .state("requests", 0)
  .derive({ as: "global" }, () => ({ traceId: "trace-1" }))
  .derive({ as: "scoped" }, () => {
    scopedDeriveCalls += 1;
    return { requestScope: "scoped" };
  })
  .derive(() => ({ pluginOnly: "local" }))
  .resolve({ as: "global" }, () => ({ tenant: "acme" }));

const cachePlugin = new Elysia({ name: "cache" }).decorate("cache", {
  read: (key: string) => `cached:${key}`,
});

@Injectable()
class SecretService {
  readonly secret = "s3cret";
}

const createUserSchema = { body: z.object({ name: z.string().min(2) }) };

@Controller("context")
class ContextController {
  @Get("decorator")
  readDecorator(@Ctx() context: ElysiaRouteContext<{}, typeof clockPlugin>): { now: string } {
    return { now: context.now() };
  }

  @Get("store")
  readStore(@Ctx() context: ElysiaRouteContext<{}, typeof clockPlugin>): { requests: number } {
    context.store.requests += 1;
    return { requests: context.store.requests };
  }

  @Get("derived")
  readDerived(@Ctx() context: ElysiaRouteContext<{}, typeof clockPlugin>): {
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
  readPluginLocal(@Ctx() context: ElysiaRouteContext<{}, typeof clockPlugin>): {
    pluginOnly: unknown;
  } {
    return { pluginOnly: (context as Record<string, unknown>).pluginOnly ?? null };
  }

  @Get("many")
  readMany(@Ctx() context: ElysiaRouteContext<{}, [typeof clockPlugin, typeof cachePlugin]>): {
    now: string;
    cached: string;
  } {
    return { now: context.now(), cached: context.cache.read("users") };
  }

  @Post("schema", createUserSchema)
  readSchemaAndPlugin(
    @Ctx() context: ElysiaRouteContext<typeof createUserSchema, typeof clockPlugin>,
  ): { name: string; traceId: string } {
    context.set.headers["x-clock"] = context.now();
    return { name: context.body.name, traceId: context.traceId };
  }

  @Get("untyped")
  readUntyped(@Ctx() context: ElysiaRouteContext): { now: unknown } {
    return { now: (context as Record<string, unknown>).now === undefined ? null : "present" };
  }
}

@Module({
  imports: [
    ElysiaPluginModule.register(clockPlugin, { key: "clock" }),
    ElysiaPluginModule.register(cachePlugin, { key: "cache" }),
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

test("exposes global and scoped derives and global resolves", async () => {
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
    read(@Ctx() context: ElysiaRouteContext<{}, Elysia<"", SecretSingleton>>): { secret: string } {
      return { secret: context.secret };
    }
  }

  @Module({ providers: [SecretService], exports: [SecretService] })
  class SecretModule {}

  @Module({
    imports: [
      ElysiaPluginModule.registerAsync({
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
  resolve: {};
}

type ClockContext = ElysiaRouteContext<{}, typeof clockPlugin>;
type ManyContext = ElysiaRouteContext<{}, [typeof clockPlugin, typeof cachePlugin]>;
type BareContext = ElysiaRouteContext;
type SchemaContext = ElysiaRouteContext<typeof createUserSchema, typeof clockPlugin>;

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
];

test("keeps the plugin context type assertions referenced", () => {
  const assertions: PluginTypeAssertions = [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ];

  expect(assertions).toHaveLength(14);
});
