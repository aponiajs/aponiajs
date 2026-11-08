import { AponiaError } from "@aponiajs/common";
import { sql } from "drizzle-orm";
import type {
  MigrationExecutor,
  MigrationFile,
  MigrationResult,
  MigrationStore,
} from "./migration.types.ts";

/** Applies ordered `.sql` migrations once each, in file-name order. */
export class MigrationRunner {
  readonly #store: MigrationStore;

  constructor(store: MigrationStore) {
    this.#store = store;
  }

  /** Runs every migration the store has not recorded yet. */
  async run(
    executor: MigrationExecutor,
    files: readonly MigrationFile[],
  ): Promise<MigrationResult> {
    const ordered = orderMigrations(files);
    const applied = new Set(await this.#store.applied());
    const ran: string[] = [];
    const skipped: string[] = [];

    for (const file of ordered) {
      if (applied.has(file.name)) {
        skipped.push(file.name);
        continue;
      }
      await executor.execute(sql.raw(file.sql));
      await this.#store.record(file.name);
      ran.push(file.name);
    }

    return Object.freeze({ applied: Object.freeze(ran), skipped: Object.freeze(skipped) });
  }
}

function orderMigrations(files: readonly MigrationFile[]): readonly MigrationFile[] {
  const names = new Set<string>();
  for (const file of files) {
    if (typeof file.name !== "string" || file.name.trim() === "") {
      throw new AponiaError("INVALID_MIGRATION", "A migration needs a name.", {
        issues: Object.freeze(["name must be a non-empty string"]),
      });
    }
    if (typeof file.sql !== "string") {
      throw new AponiaError("INVALID_MIGRATION", `Migration ${file.name} states no SQL.`, {
        issues: Object.freeze(["sql must be a string"]),
        migration: file.name,
      });
    }
    if (names.has(file.name)) {
      throw new AponiaError("INVALID_MIGRATION", `Migration ${file.name} is declared twice.`, {
        issues: Object.freeze(["names must be unique"]),
        migration: file.name,
      });
    }
    names.add(file.name);
  }
  return Object.freeze([...files].toSorted((left, right) => left.name.localeCompare(right.name)));
}
