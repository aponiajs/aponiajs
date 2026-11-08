import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MigrationFile } from "./migration.types.ts";

/** Reads every `.sql` file in one directory, ordered by file name. */
export async function loadMigrations(directory: string): Promise<readonly MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));
  const migrations = await Promise.all(
    names.map(async (name) =>
      Object.freeze({ name, sql: await readFile(join(directory, name), "utf8") }),
    ),
  );
  return Object.freeze(migrations);
}
