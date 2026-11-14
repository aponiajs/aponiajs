import { createHash } from "node:crypto";
import { AponiaError } from "@aponiajs/common";
import { sql } from "drizzle-orm";
import type {
  MigrationExecutor,
  MigrationFile,
  MigrationLock,
  MigrationResult,
  MigrationStore,
} from "./migration.types.ts";

/** Applies ordered `.sql` migrations once each, in file-name order. */
export class MigrationRunner {
  readonly #store: MigrationStore;

  constructor(store: MigrationStore) {
    this.#store = store;
  }

  /**
   * Runs every migration the store has not recorded yet.
   *
   * `lock` is the application's dialect-specific advisory lock. It is acquired
   * before the applied set is read and released in `finally`, so two replicas
   * cannot apply the same migration. Each migration and its record run inside
   * `executor.transaction` when the driver exposes one.
   */
  async run(
    executor: MigrationExecutor,
    files: readonly MigrationFile[],
    lock?: MigrationLock,
  ): Promise<MigrationResult> {
    const ordered = orderMigrations(files);
    const release = lock === undefined ? undefined : await lock();
    try {
      const applied = new Set(await this.#store.applied());
      const ran: string[] = [];
      const skipped: string[] = [];

      for (const file of ordered) {
        const checksum = checksumOf(file.sql);
        if (applied.has(file.name)) {
          const recorded = await this.#store.checksum?.(file.name);
          if (recorded !== undefined && recorded !== checksum) {
            throw new AponiaError(
              "INVALID_MIGRATION",
              `Migration ${file.name} changed after it was applied.`,
              {
                issues: Object.freeze(["an applied migration must not change"]),
                migration: file.name,
                recorded,
                expected: checksum,
              },
            );
          }
          skipped.push(file.name);
          continue;
        }

        const apply = async (target: MigrationExecutor): Promise<void> => {
          await target.execute(sql.raw(file.sql));
          await this.#store.record(file.name, checksum);
        };
        if (executor.transaction !== undefined) {
          await executor.transaction(apply);
        } else {
          await apply(executor);
        }
        ran.push(file.name);
      }

      return Object.freeze({ applied: Object.freeze(ran), skipped: Object.freeze(skipped) });
    } finally {
      if (release !== undefined) {
        await release();
      }
    }
  }
}

function checksumOf(sqlText: string): string {
  return createHash("sha256").update(sqlText).digest("hex");
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
