import { Injectable, type OnModuleDestroy } from "@aponiajs/common";
import type { RedisClientLike } from "./interfaces/redis-client.interface.ts";
import { RedisCacheStore } from "./stores/redis-cache.store.ts";
import { RedisCronLockStore } from "./stores/redis-cron-lock.store.ts";
import { RedisIdempotencyStore } from "./stores/redis-idempotency.store.ts";
import { RedisRateLimitStore } from "./stores/redis-rate-limit.store.ts";
import { RedisRefreshTokenStore } from "./stores/redis-refresh-token.store.ts";
import { RedisRevocationStore } from "./stores/redis-revocation.store.ts";
import { RedisSessionStore } from "./stores/redis-session.store.ts";

/**
 * Provides access to the configured Redis client and factory methods for
 * AponiaJS distributed stores.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly #client: RedisClientLike;
  readonly #keyPrefix: string;
  readonly #ownsClient: boolean;

  constructor(client: RedisClientLike, keyPrefix: string, ownsClient: boolean) {
    this.#client = client;
    this.#keyPrefix = keyPrefix;
    this.#ownsClient = ownsClient;
  }

  /** Returns the underlying Redis client. */
  get client(): RedisClientLike {
    return this.#client;
  }

  /** Verifies Redis connectivity via `PING`. */
  async ping(): Promise<string> {
    if (this.#client.ping !== undefined) {
      return await this.#client.ping();
    }
    return "PONG";
  }

  cacheStore(namespace = "cache:"): RedisCacheStore {
    return new RedisCacheStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  rateLimitStore(namespace = "rl:"): RedisRateLimitStore {
    return new RedisRateLimitStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  sessionStore(namespace = "sess:"): RedisSessionStore {
    return new RedisSessionStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  refreshTokenStore(namespace = "rt:"): RedisRefreshTokenStore {
    return new RedisRefreshTokenStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  revocationStore(namespace = "rev:"): RedisRevocationStore {
    return new RedisRevocationStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  idempotencyStore(namespace = "idem:"): RedisIdempotencyStore {
    return new RedisIdempotencyStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  cronLockStore(namespace = "cronlock:"): RedisCronLockStore {
    return new RedisCronLockStore(this.#client, `${this.#keyPrefix}${namespace}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.#ownsClient && this.#client.quit !== undefined) {
      await this.#client.quit();
    }
  }
}
