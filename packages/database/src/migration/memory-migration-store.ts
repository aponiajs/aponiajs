import type { MigrationStore } from "./migration.types.ts";

/** A process-local record of applied migrations. */
export class MemoryMigrationStore implements MigrationStore {
  readonly #applied = new Set<string>();

  applied(): readonly string[] {
    return Object.freeze([...this.#applied]);
  }

  record(name: string): void {
    this.#applied.add(name);
  }
}
