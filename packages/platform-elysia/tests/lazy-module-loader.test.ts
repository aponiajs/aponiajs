import { afterEach, describe, expect, test } from "bun:test";
import {
  Injectable,
  Module,
  createToken,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@aponiajs/common";
import { AponiaFactory, LazyModuleLoader, type AponiaApplication } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("LazyModuleLoader", () => {
  test("loads a module graph, runs its hooks, and closes it once", async () => {
    const calls: string[] = [];

    @Injectable()
    class LazyService
      implements
        OnModuleInit,
        OnApplicationBootstrap,
        BeforeApplicationShutdown,
        OnModuleDestroy,
        OnApplicationShutdown
    {
      read(): string {
        return "lazy";
      }

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

    @Module({ providers: [LazyService], exports: [LazyService] })
    class LazyModule {}

    @Module({})
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const loader = application.get(LazyModuleLoader);
    const ref = await loader.load(async () => LazyModule);

    expect(calls).toEqual(["init", "bootstrap"]);
    expect(ref.get(LazyService).read()).toBe("lazy");

    await ref.close();
    expect(calls).toEqual(["init", "bootstrap", "before", "destroy", "shutdown"]);
    await ref.close();
    expect(calls).toHaveLength(5);
  });

  test("keeps the lazy graph's root visibility", async () => {
    const privateToken = createToken<string>("lazy-private");

    @Module({ providers: [] })
    class LazyModule {}

    @Module({})
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const ref = await application.get(LazyModuleLoader).load(() => LazyModule);

    expect(() => ref.get(privateToken)).toThrow(
      expect.objectContaining({ code: "MISSING_PROVIDER" }),
    );
    await ref.close();
  });
});
