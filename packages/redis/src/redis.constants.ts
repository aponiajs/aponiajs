import { createToken, type InjectionToken } from "@aponiajs/common";
import type { RedisClientLike, ResolvedRedisOptions } from "./interfaces/redis-client.interface.ts";

/** Internal token carrying validated Redis options. */
export const REDIS_OPTIONS: InjectionToken<ResolvedRedisOptions> =
  createToken<ResolvedRedisOptions>("REDIS_OPTIONS");

/** Injection token for the active `RedisClientLike`. */
export const REDIS_CLIENT: InjectionToken<RedisClientLike> =
  createToken<RedisClientLike>("REDIS_CLIENT");
