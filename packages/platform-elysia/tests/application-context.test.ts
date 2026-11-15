import { describe, expect, test } from "bun:test";
import {
  Controller,
  Injectable,
  Module,
  Scope,
  createToken,
  provideFactory,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

describe("AponiaFactory.createApplicationContext", () => {
  test("boots providers, runs their hooks, and resolves from the root", async () => {
    const calls: string[] = [];

    @Injectable()
    class Service
      implements
        OnModuleInit,
        OnApplicationBootstrap,
        BeforeApplicationShutdown,
        OnModuleDestroy,
        OnApplicationShutdown
    {
      onModuleInit(): void {
        calls.push("init");
      }

      onApplicationBootstrap(): void {
        calls.push("bootstrap");
      }

      beforeApplicationShutdown(): void {
        calls.push("before");
      }

      onModuleDestroy(): void {
        calls.push("destroy");
      }

      onApplicationShutdown(): void {
        calls.push("shutdown");
      }
    }

    @Module({ providers: [Service], exports: [Service] })
    class AppModule {}

    const context = await AponiaFactory.createApplicationContext(AppModule, { logger: false });

    expect(calls).toEqual(["init", "bootstrap"]);
    expect(context.get(Service)).toBe(context.get(Service));

    await context.close();
    expect(calls).toEqual(["init", "bootstrap", "before", "destroy", "shutdown"]);

    await context.close();
    expect(calls).toEqual(["init", "bootstrap", "before", "destroy", "shutdown"]);
  });

  test("does not instantiate controllers for a worker context", async () => {
    let constructed = 0;

    @Controller("unused")
    class UnusedController {
      constructor() {
        constructed += 1;
      }
    }

    @Module({ controllers: [UnusedController] })
    class AppModule {}

    const context = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
    await context.close();

    expect(constructed).toBe(0);
  });

  test("resolves a request-scoped provider only with a request context", async () => {
    const requestScoped = createToken<string>("request-scoped-context");

    @Module({
      providers: [
        provideFactory(requestScoped, [] as const, () => "request-value", {
          scope: Scope.REQUEST,
        }),
      ],
      exports: [requestScoped],
    })
    class AppModule {}

    const context = await AponiaFactory.createApplicationContext(AppModule, { logger: false });

    expect(context.resolve(requestScoped, {})).toBe("request-value");
    expect(() => context.get(requestScoped)).toThrow(
      expect.objectContaining({ code: "MISSING_REQUEST_CONTEXT" }),
    );

    await context.close();
  });
});
