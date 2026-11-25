import type { ModuleAsyncOptions } from "@aponiajs/common";
import type { MigrationFile, MigrationLock, MigrationStore } from "./migration.interface.ts";

/** Options `DatabaseModule.forRoot` accepts. */
export interface DatabaseModuleOptions<TDatabase extends object = object> {
  /** The Drizzle database the application constructed. */
  readonly database: TDatabase;
  /** Migrations the module applies during initialization. */
  readonly migrations?: {
    readonly files: readonly MigrationFile[];
    readonly store?: MigrationStore;
    /** An application-supplied advisory lock; required for concurrent boots. */
    readonly lock?: MigrationLock;
  };
}

/** The registration options a factory supplies. */
export type DatabaseModuleAsyncOptions<TDatabase extends object = object> = ModuleAsyncOptions<
  DatabaseModuleOptions<TDatabase>
>;
