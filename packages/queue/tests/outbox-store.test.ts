import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { OutboxService, SqliteOutboxStore } from "../src/index.ts";

test("hydrates from and persists through a SQLite store", async () => {
  const database = new Database(":memory:");
  const store = new SqliteOutboxStore({ database });

  try {
    const first = new OutboxService({ store });
    first.record("user.created", { id: 1 });

    const second = new OutboxService({ store });
    expect(second.pending().map((message) => message.name)).toEqual(["user.created"]);

    const delivered: unknown[] = [];
    const result = await second.flush((message) => {
      delivered.push(message.payload);
    });

    expect(result.delivered).toBe(1);
    expect(delivered).toEqual([{ id: 1 }]);
    expect(new OutboxService({ store }).pending()).toEqual([]);

    first.record("user.deleted", { id: 3 });
    first.clear();
    expect(new OutboxService({ store }).pending()).toEqual([]);
  } finally {
    database.close();
  }
});

test("keeps a failed message and its attempt count across a restart", async () => {
  const database = new Database(":memory:");
  const store = new SqliteOutboxStore({ database });

  try {
    const first = new OutboxService({ store });
    first.record("user.created", { id: 2 });

    let failure: unknown;
    try {
      await first.flush(() => {
        throw new Error("sink refused");
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "OUTBOX_DELIVERY_FAILED" });

    const restarted = new OutboxService({ store });
    const pending = restarted.pending();

    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBe(1);
  } finally {
    database.close();
  }
});

test("refuses an unsafe table name", () => {
  const database = new Database(":memory:");
  try {
    expect(() => new SqliteOutboxStore({ database, table: "outbox; DROP TABLE users" })).toThrow(
      expect.objectContaining({ code: "INVALID_QUEUE_OPTIONS" }),
    );
  } finally {
    database.close();
  }
});
