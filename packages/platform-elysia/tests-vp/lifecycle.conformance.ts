import {
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@aponiajs/common";

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
  beforeApplicationShutdown(): void {}
  onApplicationShutdown(): void {}
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
  async beforeApplicationShutdown(): Promise<void> {}
  async onApplicationShutdown(): Promise<void> {}
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
