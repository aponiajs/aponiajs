/** One ordered SQL migration. */
export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

/** The names a migration store already applied. */
export interface MigrationStore {
  applied(): readonly string[] | PromiseLike<readonly string[]>;
  record(name: string): void | PromiseLike<void>;
}

/** What one migration run did. */
export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/** The statement runner a migration needs. */
export interface MigrationExecutor {
  execute(query: unknown): unknown;
}
