import {
  Module,
  provideClass,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

/**
 * The five contracts, each satisfied by a synchronous method and by one that
 * returns a promise. A contract that stopped accepting either would fail
 * `bun run check` here rather than in an application.
 */
class SyncHooks
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  onModuleInit(): void {}
  onApplicationBootstrap(): void {}
  onModuleDestroy(): void {}
  beforeApplicationShutdown(_signal?: string): void {}
  onApplicationShutdown(_signal?: string): void {}
}

class AsyncHooks
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  async onModuleInit(): Promise<void> {}
  async onApplicationBootstrap(): Promise<void> {}
  async onModuleDestroy(): Promise<void> {}
  async beforeApplicationShutdown(_signal?: string): Promise<void> {}
  async onApplicationShutdown(_signal?: string): Promise<void> {}
}

test("a synchronous hook answers nothing and an asynchronous one answers a promise", () => {
  const sync = new SyncHooks();
  const asynchronous = new AsyncHooks();

  // Compiling is the whole assertion: a class that stopped satisfying a contract
  // fails `bun run check`. These calls exercise the two local doubles, and they
  // cannot fail on a contract change at runtime.
  expect(sync.onModuleInit()).toBeUndefined();
  expect(sync.onApplicationBootstrap()).toBeUndefined();
  expect(sync.onModuleDestroy()).toBeUndefined();
  expect(sync.beforeApplicationShutdown()).toBeUndefined();
  expect(sync.onApplicationShutdown()).toBeUndefined();
  expect(asynchronous.onModuleInit()).toBeInstanceOf(Promise);
  expect(asynchronous.onApplicationShutdown()).toBeInstanceOf(Promise);
});

test("runs a provider's onModuleInit through a real boot", async () => {
  const calls: string[] = [];

  class Hooked {
    onModuleInit(): void {
      calls.push("init");
    }
  }

  @Module({ providers: [provideClass(Hooked, [])] })
  class HookedModule {}

  const application = await AponiaFactory.create(HookedModule, { logger: false });
  try {
    expect(calls).toEqual(["init"]);
  } finally {
    await application.close();
  }
});

test("runs a provider's onApplicationShutdown through a real close", async () => {
  const calls: string[] = [];
  let receivedSignal: string | undefined;

  class Hooked implements OnApplicationShutdown {
    onApplicationShutdown(signal?: string): void {
      calls.push("shutdown");
      receivedSignal = signal;
    }
  }

  @Module({ providers: [provideClass(Hooked, [])] })
  class HookedModule {}

  const application = await AponiaFactory.create(HookedModule, { logger: false });
  await application.close(true, "SIGINT");
  // The second close also exercises the once-only rule in this lane: both lanes
  // mirror framework behaviour, and a teardown that ran twice would show here as
  // two entries rather than one.
  await application.close();

  expect(calls).toEqual(["shutdown"]);
  expect(receivedSignal).toBe("SIGINT");
});
