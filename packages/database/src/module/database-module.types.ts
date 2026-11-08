import type { MigrationFile, MigrationStore } from "../migration/migration.types.ts";

/** Options `DatabaseModule.register` accepts. */
export interface DatabaseModuleOptions<TDatabase extends object = object> {
  /** The Drizzle database the application constructed. */
  readonly database: TDatabase;
  /** Migrations the module applies during initialization. */
  readonly migrations?: {
    readonly files: readonly MigrationFile[];
    readonly store?: MigrationStore;
  };
}
