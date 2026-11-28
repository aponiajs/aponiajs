/**
 * `@aponiajs/database` — a Drizzle-first database boundary.
 *
 * The package owns the transaction boundary, a typed repository over one
 * Drizzle table, and ordered SQL migrations. It builds no connection pool and
 * picks no dialect: the application constructs its Drizzle database and hands
 * it to `DatabaseModule.forRoot`.
 */
export { DatabaseModule } from "./database.module.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type DatabaseModuleExtras,
  type DatabaseModuleRegistrationAsyncOptions,
  type DatabaseModuleSyncOptions,
} from "./database.module-definition.ts";
export { DatabaseService } from "./database.service.ts";
export { createRepository } from "./repository/repository.ts";
export { MigrationRunner } from "./migration/migration-runner.ts";
export { MemoryMigrationStore } from "./migration/memory-migration.store.ts";
export { loadMigrations } from "./migration/migration-files.ts";
export type {
  Awaitable,
  DatabaseClient,
  DatabaseServiceOptions,
  DatabaseTransaction,
} from "./interfaces/database.interface.ts";
export type {
  DatabaseModuleAsyncOptions,
  DatabaseModuleOptions,
} from "./interfaces/database-module.interface.ts";
export type {
  InsertOf,
  Repository,
  RepositoryCondition,
  RepositoryDatabase,
  RepositoryQuery,
  RepositorySelect,
  RowOf,
  TableWithId,
} from "./interfaces/repository.interface.ts";
export type {
  MigrationExecutor,
  MigrationFile,
  MigrationResult,
  MigrationStore,
} from "./interfaces/migration.interface.ts";
