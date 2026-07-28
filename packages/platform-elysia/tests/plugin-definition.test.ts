import { expect, test } from "bun:test";
import { Controller, Ctx, Get, Module, defineModule } from "@aponiajs/common";
import { Elysia } from "elysia";
import { AponiaFactory, defineElysiaPlugin, type ElysiaRouteContext as e } from "../src/index.ts";

// A plugin exported as a value and a same-named type is usable in both
// positions, so a handler annotates it without `typeof`.
const clock = defineElysiaPlugin(
  new Elysia({ name: "clock" })
    .decorate("now", () => "2026-07-28T00:00:00.000Z")
    .state("requests", 0)
    .derive({ as: "global" }, () => ({ traceId: "trace-1" })),
  { key: "clock" },
);
type clock = typeof clock;

const cache = defineElysiaPlugin(
  new Elysia({ name: "cache" }).decorate("cache", { read: (key: string) => `cached:${key}` }),
  { key: "cache" },
);
type cache = typeof cache;

const descriptorPlugin = defineElysiaPlugin(
  new Elysia({ name: "descriptor-plugin" }).get("/defined-descriptor", () => "descriptor"),
  { key: "descriptor-plugin" },
);
const descriptorModule = defineModule({
  id: "DefinedDescriptorModule",
  imports: [descriptorPlugin],
});

@Controller("defined")
class DefinedController {
  @Get()
  read(@Ctx() context: e<clock>): { now: string; traceId: string; requests: number } {
    context.store.requests += 1;
    return { now: context.now(), traceId: context.traceId, requests: context.store.requests };
  }

  @Get("both")
  readBoth(@Ctx() context: e<[clock, cache]>): { now: string; cached: string } {
    return { now: context.now(), cached: context.cache.read("users") };
  }
}

@Module({ imports: [clock, cache], controllers: [DefinedController] })
class DefinedModule {}

async function get(path: string): Promise<Response> {
  const application = await AponiaFactory.create(DefinedModule, { logger: false });
  return application.handle(new Request(`http://localhost${path}`));
}

test("mounts a defined plugin straight from module imports", async () => {
  const response = await get("/defined");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    now: "2026-07-28T00:00:00.000Z",
    traceId: "trace-1",
    requests: 1,
  });
});

test("types several defined plugins at once", async () => {
  const response = await get("/defined/both");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    now: "2026-07-28T00:00:00.000Z",
    cached: "cached:users",
  });
});

test("keeps the native plugin reachable on the import it produces", () => {
  expect(clock.plugin).toBeInstanceOf(Elysia);
  expect(clock.id).toBe("ElysiaPluginModule[clock]");
  expect(Object.isFrozen(clock)).toBe(true);
});

test("mounts a defined plugin from a descriptor-authored module", async () => {
  const application = await AponiaFactory.createNative(descriptorModule, {
    logger: false,
  });
  const response = await application.handle(new Request("http://localhost/defined-descriptor"));

  expect(await response.text()).toBe("descriptor");
  expect(descriptorPlugin.imports).toEqual([]);
  expect(descriptorPlugin.controllers).toEqual([]);
  expect(descriptorPlugin.exports).toEqual([]);
  expect(Object.isFrozen(descriptorPlugin.providers)).toBe(true);
});

test("rejects an empty key exactly as register does", () => {
  expect(() => defineElysiaPlugin(new Elysia(), { key: "  " })).toThrow(
    "Elysia plugin module key must not be empty.",
  );
});

test("keeps two defined plugins with the same key from mounting twice", async () => {
  const duplicate = defineElysiaPlugin(new Elysia({ name: "duplicate" }), { key: "duplicate" });
  const other = defineElysiaPlugin(new Elysia({ name: "other" }), { key: "duplicate" });

  @Module({ imports: [duplicate, other] })
  class DuplicateModule {}

  expect(AponiaFactory.create(DuplicateModule, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "DUPLICATE_MODULE" }),
  );
});

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

type DefinitionTypeAssertions = [
  Expect<Equals<e<clock>["now"], () => "2026-07-28T00:00:00.000Z">>,
  Expect<Equals<e<clock>["traceId"], "trace-1">>,
  Expect<Equals<e<clock>["store"], { requests: number }>>,
  Expect<Equals<e<[clock, cache]>["cache"], { read: (key: string) => string }>>,
  Expect<Equals<"cache" extends keyof e<clock> ? true : false, false>>,
  Expect<Equals<e<clock>, e<typeof clock>>>,
  Expect<Equals<e<clock>, ElysiaRouteContextThroughInstance>>,
];

type ElysiaRouteContextThroughInstance = e<(typeof clock)["plugin"]>;

test("keeps the plugin definition type assertions referenced", () => {
  const assertions: DefinitionTypeAssertions = Array.from(
    { length: 7 },
    () => true,
  ) as DefinitionTypeAssertions;

  expect(assertions).toHaveLength(7);
});
