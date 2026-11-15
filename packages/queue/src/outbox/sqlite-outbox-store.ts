import type { Database } from "bun:sqlite";
import { AponiaError } from "@aponiajs/common";
import type { OutboxMessage, OutboxStore } from "./outbox.types.ts";

/** Options for one SQLite-backed outbox store. */
export interface SqliteOutboxStoreOptions {
  /** The open database the store owns its table in. */
  readonly database: Database;
  /** The table name; defaults to `aponia_outbox`. */
  readonly table?: string;
}

interface OutboxRow {
  readonly id: string;
  readonly name: string;
  readonly payload: string;
  readonly attempts: number;
  readonly recorded_at: number;
}

const validTableName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A durable outbox over SQLite.
 *
 * The application owns the database and its file; this class owns one table and
 * creates it if it is absent. Payloads are stored as JSON, so a value that
 * `JSON.stringify` cannot state is stored as `null` rather than losing the
 * message.
 */
export class SqliteOutboxStore implements OutboxStore {
  readonly #database: Database;
  readonly #table: string;

  constructor(options: SqliteOutboxStoreOptions) {
    const table = options.table ?? "aponia_outbox";
    if (!validTableName.test(table)) {
      throw new AponiaError(
        "INVALID_QUEUE_OPTIONS",
        "The SQLite outbox table name must be a plain identifier.",
        { issues: Object.freeze(["table must match /^[A-Za-z_][A-Za-z0-9_]*$/"]) },
      );
    }

    this.#database = options.database;
    this.#table = table;
    this.#database.run(
      `CREATE TABLE IF NOT EXISTS "${table}" (` +
        "id TEXT PRIMARY KEY NOT NULL, " +
        "name TEXT NOT NULL, " +
        "payload TEXT NOT NULL, " +
        "attempts INTEGER NOT NULL, " +
        "recorded_at INTEGER NOT NULL)",
    );
  }

  list(): readonly OutboxMessage[] {
    const rows = this.#database
      .query(
        `SELECT id, name, payload, attempts, recorded_at FROM "${this.#table}" ORDER BY recorded_at ASC, id ASC`,
      )
      .all() as OutboxRow[];

    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          name: row.name,
          payload: JSON.parse(row.payload) as unknown,
          attempts: row.attempts,
          recordedAt: row.recorded_at,
        }),
      ),
    );
  }

  append(message: OutboxMessage): void {
    this.#database
      .query(
        `INSERT OR REPLACE INTO "${this.#table}" (id, name, payload, attempts, recorded_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.name,
        JSON.stringify(message.payload) ?? "null",
        message.attempts,
        message.recordedAt,
      );
  }

  update(message: OutboxMessage): void {
    this.#database
      .query(`UPDATE "${this.#table}" SET attempts = ? WHERE id = ?`)
      .run(message.attempts, message.id);
  }

  remove(id: string): void {
    this.#database.query(`DELETE FROM "${this.#table}" WHERE id = ?`).run(id);
  }

  clear(): void {
    this.#database.run(`DELETE FROM "${this.#table}"`);
  }
}
