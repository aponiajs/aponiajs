import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { DatabaseService } from "../src/index.ts";

/**
 * Live PostgreSQL checks.
 *
 * Bun's default glob skips `*.e2e-spec.ts`. `bun run test:postgres` runs this
 * file, and the case is skipped unless `APONIA_POSTGRES_E2E=1`.
 */
const enabled = process.env.APONIA_POSTGRES_E2E === "1";

test.skipIf(!enabled)("runs statements and a transaction against PostgreSQL", async () => {
  const client = new Client({
    connectionString:
      process.env.APONIA_POSTGRES_URL ?? "postgres://aponia:aponia@127.0.0.1:5432/aponia",
  });
  await client.connect();

  const service = new DatabaseService({ database: drizzle(client) });

  try {
    await service.execute(sql`DROP TABLE IF EXISTS aponia_live`);
    await service.execute(sql`CREATE TABLE aponia_live (name text NOT NULL)`);
    await service.execute(sql`INSERT INTO aponia_live (name) VALUES (${"ada"})`);

    const selected = (await service.execute(sql`SELECT name FROM aponia_live`)) as {
      readonly rows?: readonly { readonly name: string }[];
    };
    expect(selected.rows).toEqual([{ name: "ada" }]);

    let rolledBack = false;
    try {
      await service.transaction(async (transaction) => {
        const handle = transaction.client as {
          execute(query: unknown): Promise<unknown>;
        };
        await handle.execute(sql`INSERT INTO aponia_live (name) VALUES (${"grace"})`);
        throw new Error("rollback");
      });
    } catch {
      rolledBack = true;
    }

    expect(rolledBack).toBe(true);
    const after = (await service.execute(sql`SELECT name FROM aponia_live`)) as {
      readonly rows?: readonly unknown[];
    };
    expect(after.rows).toEqual([{ name: "ada" }]);
  } finally {
    await service.execute(sql`DROP TABLE IF EXISTS aponia_live`).catch(() => {});
    await client.end();
  }
});
