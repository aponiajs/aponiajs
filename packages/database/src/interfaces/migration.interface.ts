/** One ordered SQL migration. */
export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

/** The names a migration store already applied. */
export interface MigrationStore {
  applied(): readonly string[] | PromiseLike<readonly string[]>;
  record(name: string, checksum?: string): void | PromiseLike<void>;
  /** The checksum recorded for an applied migration, when the store keeps one. */
  checksum?(name: string): string | undefined | PromiseLike<string | undefined>;
}

/** What one migration run did. */
export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/** The statement runner a migration needs. */
export interface MigrationExecutor {
  execute(query: unknown): unknown;
  /** Runs one migration and its record inside the driver's transaction. */
  transaction?<T>(run: (executor: MigrationExecutor) => T | PromiseLike<T>): T | PromiseLike<T>;
}

/** Acquires an application-supplied lock and returns its release. */
export type MigrationLock = () => Promise<() => Promise<void>>;
