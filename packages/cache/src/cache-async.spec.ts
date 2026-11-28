import { afterEach, expect, test } from "bun:test";
import { AponiaError, createToken, Module, provideValue } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { CacheModule, CacheService } from "./index.ts";

const PREFIX = createToken<string>("test.cache.prefix");

@Module({ providers: [provideValue(PREFIX, "boot")], exports: [PREFIX] })
class PrefixModule {}

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

test("forRootAsync resolves its options through the container", async () => {
  @Module({
    imports: [
      CacheModule.forRootAsync({
        imports: [PrefixModule],
        inject: [PREFIX],
        useFactory: (prefix: string) => ({ keyPrefix: `${prefix}:`, ttlMs: 1_000 }),
      }),
    ],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });
  const cache = application.get(CacheService);

  await cache.set("key", "value");

  expect(await cache.get<string>("key")).toBe("value");
});

test("forRootAsync validates the factory result when it resolves", async () => {
  @Module({
    imports: [
      CacheModule.forRootAsync({
        useFactory: () => ({ ttlMs: -1 }),
      }),
    ],
  })
  class AppModule {}

  const failure = AponiaFactory.create(AppModule, { logger: false });

  expect(await failure.catch((error: unknown) => error)).toBeInstanceOf(AponiaError);
});
