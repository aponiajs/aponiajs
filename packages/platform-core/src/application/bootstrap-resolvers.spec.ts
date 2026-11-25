import { expect, test } from "bun:test";
import {
  AponiaError,
  Catch,
  createToken,
  type ExceptionFilter,
  type ModuleDefinition,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { resolveGatewayFilters, resolveGlobal } from "./bootstrap.resolver.ts";
import type { GatewayPlan } from "../interfaces/gateway.interface.ts";

@Catch()
class GatewayFilter implements ExceptionFilter {
  catch(): void {}
}

@Catch()
class HandlerFilter implements ExceptionFilter {
  catch(): void {}
}

test("merges a handler's filters with the gateway's class-scope filters", () => {
  const instances = new Map<unknown, object>();
  const container = {
    resolveModuleProvider: (_module: ModuleDefinition, token: unknown) => {
      const instance = new (token as new () => object)();
      instances.set(token, instance);
      return instance;
    },
  } as unknown as AponiaContainer;
  const plan: GatewayPlan = {
    path: "/ws",
    guards: [],
    filters: [GatewayFilter],
    handlers: [
      { event: "own", propertyKey: "own", parameters: [], filters: [HandlerFilter] },
      { event: "inherited", propertyKey: "inherited", parameters: [] },
    ],
  };

  const byEvent = resolveGatewayFilters(container, {} as ModuleDefinition, plan);

  const own = byEvent.get("own") ?? [];
  expect(own.length).toBe(2);
  expect(own[0]?.instance).toBeInstanceOf(HandlerFilter);
  expect(own[1]?.instance).toBeInstanceOf(GatewayFilter);
  const inherited = byEvent.get("inherited") ?? [];
  expect(inherited.length).toBe(1);
  expect(inherited[0]?.instance).toBeInstanceOf(GatewayFilter);
  expect(inherited[0]?.instance).toBe(own[1]?.instance);
  expect(byEvent.has("missing")).toBe(false);
  for (const resolved of byEvent.values()) {
    expect(Object.isFrozen(resolved)).toBe(true);
  }
});

test("rethrows a failure that is not a missing global provider", () => {
  const failure = new Error("resolve failed");
  const token = createToken("global");
  const module = {
    id: "app",
    providers: [{ kind: "value", provide: token, useValue: [] }],
    imports: [],
    controllers: [],
    exports: [],
  } as unknown as ModuleDefinition;
  const container = {
    graph: { root: module, modules: [module] },
    resolveProvider: () => {
      throw failure;
    },
  } as unknown as AponiaContainer;

  expect(() => resolveGlobal(container, token)).toThrow("resolve failed");
});

test("refuses a global class the graph does not provide", () => {
  class Guard {
    readonly constructed = true;
  }

  const token = createToken("APP_GUARD");
  const module = {
    id: "app",
    providers: [{ kind: "value", provide: token, useValue: [Guard] }],
    imports: [],
    controllers: [],
    exports: [],
  } as unknown as ModuleDefinition;
  const container = {
    graph: { root: module, modules: [module] },
    resolveProvider: (_module: ModuleDefinition, provider: { useValue?: unknown }) =>
      provider.useValue,
    resolveModuleProvider: () => {
      throw new AponiaError("MISSING_PROVIDER", "not provided", { token: "Guard" });
    },
  } as unknown as AponiaContainer;

  expect(() => resolveGlobal<Guard>(container, token)).toThrow(
    expect.objectContaining({ code: "MISSING_PROVIDER" }),
  );
});
