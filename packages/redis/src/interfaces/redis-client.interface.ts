import type { ConfigurableModuleAsyncOptions } from "@aponiajs/common";

/** Options accepted by `RedisClientLike.set`. */
export interface RedisSetOptions {
  readonly PX?: number;
  readonly NX?: boolean;
}

/**
 * Minimal structural Redis client contract compatible with `redis@^6.3.1`
 * and deterministic test doubles.
 */
export interface RedisClientLike {
  readonly isOpen?: boolean;
  connect?(): Promise<unknown>;
  quit?(): Promise<unknown>;
  ping?(message?: string): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<string | null>;
  del(keys: string | readonly string[]): Promise<number>;
  sAdd?(key: string, members: string | readonly string[]): Promise<number>;
  sMembers?(key: string): Promise<string[]>;
  pExpire?(key: string, milliseconds: number): Promise<number>;
  eval?(
    script: string,
    options: { readonly keys: readonly string[]; readonly arguments: readonly string[] },
  ): Promise<unknown>;
  scan?(
    cursor: string | number,
    options?: { readonly MATCH?: string; readonly COUNT?: number },
  ): Promise<{ readonly cursor: string | number; readonly keys: readonly string[] }>;
}

/** Options accepted by `RedisModule.forRoot`. */
export interface RedisModuleOptions {
  /** Redis connection URL (e.g. `redis://localhost:6379`). Used when `client` is omitted. */
  readonly url?: string;
  /** Pre-configured Redis client instance; module will not close it on shutdown. */
  readonly client?: RedisClientLike;
  /** Key prefix prepended by all `RedisService` stores; defaults to `"aponia:"`. */
  readonly keyPrefix?: string;
}

/** Validated options resolved by `RedisModule`. */
export interface ResolvedRedisOptions {
  readonly url: string | undefined;
  readonly client: RedisClientLike | undefined;
  readonly keyPrefix: string;
}

/** Asynchronous options accepted by `RedisModule.forRootAsync`. */
export type RedisModuleAsyncOptions = ConfigurableModuleAsyncOptions<RedisModuleOptions>;
