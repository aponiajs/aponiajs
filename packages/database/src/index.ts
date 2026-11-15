/**
 * `@aponiajs/database` — a Drizzle-first database boundary.
 *
 * The package owns the transaction boundary, a typed repository over one
 * Drizzle table, and ordered SQL migrations. It builds no connection pool and
 * picks no dialect: the application constructs its Drizzle database and hands
 * it to `DatabaseModule.register`.
 */
export { DatabaseModule } from "./module/database-module.ts";
export { DatabaseService } from "./database/database.service.ts";
export { createRepository } from "./repository/repository.ts";
export { MigrationRunner } from "./migration/migration-runner.ts";
export { MemoryMigrationStore } from "./migration/memory-migration-store.ts";
export { loadMigrations } from "./migration/migration-files.ts";
export type {
  Awaitable,
  DatabaseClient,
  DatabaseServiceOptions,
  DatabaseTransaction,
} from "./database/database.types.ts";
export type { DatabaseModuleOptions } from "./module/database-module.types.ts";
export type {
  InsertOf,
  Repository,
  RepositoryCondition,
  RepositoryDatabase,
  RepositoryQuery,
  RepositorySelect,
  RowOf,
  TableWithId,
} from "./repository/repository.types.ts";
export type {
  MigrationExecutor,
  MigrationFile,
  MigrationResult,
  MigrationStore,
} from "./migration/migration.types.ts";
