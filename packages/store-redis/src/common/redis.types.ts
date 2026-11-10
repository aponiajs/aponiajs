/** Structural interface for a minimal Redis client. */
export interface RedisClientInterface {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean },
  ): Promise<string | null>;
  del(key: string | readonly string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean | number>;
  pExpire?(key: string, milliseconds: number): Promise<boolean | number>;
  keys(pattern: string): Promise<string[]>;
  eval(script: string, options?: { keys?: string[]; arguments?: string[] }): Promise<unknown>;
  quit?(): Promise<string>;
  disconnect?(): Promise<void>;
}

/** Options for configuring a Redis store. */
export interface RedisStoreOptions {
  /** The Redis client instance or factory. */
  readonly client: RedisClientInterface;
  /** Optional key prefix for namespacing; defaults to a domain-specific prefix. */
  readonly prefix?: string;
}
