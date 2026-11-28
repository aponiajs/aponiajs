import {
  AponiaError,
  Module,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import type {
  RedisClientLike,
  RedisModuleOptions,
  ResolvedRedisOptions,
} from "./interfaces/redis-client.interface.ts";
import { REDIS_CLIENT, REDIS_OPTIONS } from "./redis.constants.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type RedisModuleRegistrationAsyncOptions,
  type RedisModuleSyncOptions,
} from "./redis.module-definition.ts";
import { RedisService } from "./redis.service.ts";

/**
 * Registers `RedisService`, `REDIS_CLIENT`, and distributed Redis store factories.
 */
@Module({})
export class RedisModule extends ConfigurableModuleClass {
  static forRoot(options: RedisModuleSyncOptions = {}): DynamicModule {
    resolveRedisOptions(options);
    return registration(super.register(options));
  }

  static forRootAsync(options: RedisModuleRegistrationAsyncOptions): DynamicModule {
    return registration(super.registerAsync(options), options.extraProviders);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: RedisModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(REDIS_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: RedisModuleOptions) =>
        resolveRedisOptions(options),
      ),
      provideFactory(
        REDIS_CLIENT,
        [REDIS_OPTIONS],
        async (options: ResolvedRedisOptions): Promise<RedisClientLike> => {
          if (options.client !== undefined) {
            return options.client;
          }
          const { createClient } = await import("redis");
          const client = createClient({ url: options.url });
          if (!client.isOpen) {
            await client.connect();
          }
          return client as unknown as RedisClientLike;
        },
      ),
      provideFactory(
        RedisService,
        [REDIS_CLIENT, REDIS_OPTIONS],
        (client: RedisClientLike, options: ResolvedRedisOptions) =>
          new RedisService(client, options.keyPrefix, options.client === undefined),
      ),
      ...extraProviders,
    ]),
    exports: Object.freeze([
      ...(definition.exports ?? []),
      MODULE_OPTIONS_TOKEN,
      REDIS_CLIENT,
      RedisService,
    ]),
  });
}

function resolveRedisOptions(options: RedisModuleOptions): ResolvedRedisOptions {
  if (options.client === undefined && (options.url === undefined || options.url.trim() === "")) {
    throw new AponiaError(
      "INVALID_REDIS_OPTIONS",
      "RedisModule requires either a non-empty url or a pre-configured client.",
      { status: 500 },
    );
  }
  const keyPrefix = options.keyPrefix ?? "aponia:";
  return Object.freeze({
    url: options.url,
    client: options.client,
    keyPrefix,
  });
}
