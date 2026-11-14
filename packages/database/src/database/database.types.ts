/** A callbackable result: a synchronous driver and a promise-returning one both fit. */
export type Awaitable<T> = T | PromiseLike<T>;

/** The narrow surface one transaction exposes. */
export interface DatabaseTransaction {
  /** The driver's transaction object, for queries this package does not model. */
  readonly client: unknown;
  /** Runs one raw statement. */
  execute(query: unknown): Awaitable<unknown>;
}

/** The narrow surface a registered Drizzle database must expose. */
export interface DatabaseClient {
  transaction?(run: (transaction: never) => unknown, config?: unknown): unknown;
  execute?(query: unknown): Awaitable<unknown>;
  run?(query: unknown): Awaitable<unknown>;
  select?(...args: never[]): unknown;
  insert?(table: unknown): unknown;
  update?(table: unknown): unknown;
  delete?(table: unknown): unknown;
}

/** Options `DatabaseService` accepts. */
export interface DatabaseServiceOptions {
  /** The Drizzle database instance the application constructed. */
  readonly database: DatabaseClient;
  /** Migrations the service applies when the module initializes. */
  readonly migrations?:
    | {
        readonly files: readonly MigrationFile[];
        readonly store?: MigrationStore;
        readonly lock?: MigrationLock;
      }
    | undefined;
}
import type { MigrationFile, MigrationLock, MigrationStore } from "../migration/migration.types.ts";
