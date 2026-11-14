import type { MigrationStore } from "./migration.types.ts";

/** A process-local record of applied migrations. */
export class MemoryMigrationStore implements MigrationStore {
  readonly #applied = new Set<string>();
  readonly #checksums = new Map<string, string>();

  applied(): readonly string[] {
    return Object.freeze([...this.#applied]);
  }

  record(name: string, checksum?: string): void {
    this.#applied.add(name);
    if (checksum !== undefined) {
      this.#checksums.set(name, checksum);
    }
  }

  checksum(name: string): string | undefined {
    return this.#checksums.get(name);
  }
}
