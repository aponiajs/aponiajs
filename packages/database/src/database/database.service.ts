import { AponiaError, type OnModuleInit } from "@aponiajs/common";
import { MemoryMigrationStore } from "../migration/memory-migration-store.ts";
import { MigrationRunner } from "../migration/migration-runner.ts";
import type {
  MigrationFile,
  MigrationResult,
  MigrationStore,
} from "../migration/migration.types.ts";
import type { DatabaseClient, DatabaseTransaction } from "./database.types.ts";

/**
 * The Drizzle database an application registered, and its transaction boundary.
 *
 * The class keeps the caller's database type so `client` answers exactly what
 * the application constructed. The narrow operations this package needs are
 * checked at the moment they run.
 */
export class DatabaseService<TDatabase extends object = object> implements OnModuleInit {
  readonly #client: TDatabase;
  readonly #migrations:
    | { readonly files: readonly MigrationFile[]; readonly store: MigrationStore }
    | undefined;

  /** @internal Construct through `DatabaseModule.register`. */
  constructor(options: {
    readonly database: TDatabase;
    readonly migrations?: {
      readonly files: readonly MigrationFile[];
      readonly store?: MigrationStore;
    };
  }) {
    if (typeof options.database !== "object" || options.database === null) {
      throw new AponiaError("INVALID_DATABASE_OPTIONS", "A DatabaseService needs a database.", {
        issues: Object.freeze(["database must be a Drizzle database instance"]),
      });
    }
    this.#client = options.database;
    this.#migrations =
      options.migrations === undefined
        ? undefined
        : Object.freeze({
            files: Object.freeze([...options.migrations.files]),
            store: options.migrations.store ?? new MemoryMigrationStore(),
          });
  }

  /** The registered Drizzle database, for queries the application writes itself. */
  get client(): TDatabase {
    return this.#client;
  }

  /**
   * Runs one unit of work inside the driver's transaction boundary.
   *
   * The callback receives a narrow transaction handle. Use `transaction.client`
   * when the application needs the driver's own transaction object. This
   * variant awaits the callback, so it needs a driver whose transaction is
   * asynchronous; a synchronous driver commits when the callback returns and
   * must use `transactionSync`.
   */
  async transaction<T>(run: (transaction: DatabaseTransaction) => T | Promise<T>): Promise<T> {
    const database = this.#database();
    if (typeof database.transaction !== "function") {
      throw new AponiaError(
        "INVALID_DATABASE_OPTIONS",
        "The registered database states no transaction boundary.",
        Object.freeze({ issues: Object.freeze(["database.transaction must be a function"]) }),
      );
    }
    return (await database.transaction(
      async (transaction: unknown) => await run(transactionHandle(database, transaction)),
    )) as T;
  }

  /** Runs one synchronous unit of work inside a synchronous driver's boundary. */
  transactionSync<T>(run: (transaction: DatabaseTransaction) => T): T {
    const database = this.#database();
    if (typeof database.transaction !== "function") {
      throw new AponiaError(
        "INVALID_DATABASE_OPTIONS",
        "The registered database states no transaction boundary.",
        Object.freeze({ issues: Object.freeze(["database.transaction must be a function"]) }),
      );
    }
    return database.transaction((transaction: unknown) =>
      run(transactionHandle(database, transaction)),
    ) as T;
  }

  /** Runs one raw statement outside an explicit transaction. */
  async execute(query: unknown): Promise<unknown> {
    const database = this.#database();
    if (typeof database.execute === "function") {
      return await database.execute(query);
    }
    if (typeof database.run === "function") {
      return await database.run(query);
    }
    throw new AponiaError(
      "INVALID_DATABASE_OPTIONS",
      "The registered database cannot run a raw statement.",
      Object.freeze({ issues: Object.freeze(["database.execute or database.run is required"]) }),
    );
  }

  /** Applies every pending migration the registration declared. */
  async migrate(): Promise<MigrationResult> {
    if (this.#migrations === undefined) {
      return Object.freeze({ applied: Object.freeze([]), skipped: Object.freeze([]) });
    }
    const runner = new MigrationRunner(this.#migrations.store);
    return await runner.run(this, this.#migrations.files);
  }

  /** @internal The module init hook applies declared migrations before handlers run. */
  async onModuleInit(): Promise<void> {
    await this.migrate();
  }

  #database(): DatabaseClient {
    return this.#client as unknown as DatabaseClient;
  }
}

function transactionHandle(client: DatabaseClient, transaction: unknown): DatabaseTransaction {
  return Object.freeze({
    client: transaction,
    execute: async (query: unknown): Promise<unknown> => {
      const candidate = transaction as {
        readonly execute?: (statement: unknown) => unknown;
        readonly run?: (statement: unknown) => unknown;
      };
      if (typeof candidate.execute === "function") {
        return await candidate.execute(query);
      }
      if (typeof candidate.run === "function") {
        return await candidate.run(query);
      }
      if (typeof client.execute === "function") {
        return await client.execute(query);
      }
      if (typeof client.run === "function") {
        return await client.run(query);
      }
      throw new AponiaError(
        "INVALID_DATABASE_OPTIONS",
        "The transaction cannot run a raw statement.",
        Object.freeze({
          issues: Object.freeze(["transaction.execute or transaction.run is required"]),
        }),
      );
    },
  });
}
