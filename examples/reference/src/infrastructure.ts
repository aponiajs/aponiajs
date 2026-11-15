import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { AuthModule } from "@aponiajs/auth";
import { DatabaseModule } from "@aponiajs/database";
import { MetricsModule, MetricsRegistry } from "@aponiajs/metrics";
import { QueueModule } from "@aponiajs/queue";
import { drizzle } from "drizzle-orm/bun-sqlite";

/**
 * The one database the application owns.
 *
 * The example uses an in-memory SQLite database so a test boot starts clean;
 * a deployment passes its own Drizzle instance here instead.
 */
export const database = drizzle(new Database(":memory:"));

export const databaseModule = DatabaseModule.register({
  database,
  migrations: {
    files: [
      {
        name: "001-users.sql",
        sql: [
          "create table users (",
          "  id text primary key,",
          "  email text not null unique,",
          "  name text not null,",
          "  password_hash text not null,",
          "  roles text not null,",
          "  created_at integer not null",
          ")",
        ].join("\n"),
      },
    ],
  },
});

export const authModule = AuthModule.register({
  jwt: {
    secret: Bun.env.JWT_SECRET ?? "reference-application-dev-secret-key",
    issuer: "aponia-reference",
    audience: "aponia-reference-api",
    expiresIn: "15m",
  },
  refresh: { ttlMs: 7 * 24 * 60 * 60 * 1_000 },
});

export const queueModule = QueueModule.register({
  queue: { concurrency: 2, maxAttempts: 3, backoffMs: 25 },
});

export const metrics = new MetricsRegistry({ prefix: "reference" });

export const metricsModule = MetricsModule.register({ registry: metrics, path: "/metrics" });

/** The access-token id a login issues, so the example can revoke it. */
export function newTokenId(): string {
  return randomUUID();
}
