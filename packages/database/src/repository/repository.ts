import { AponiaError } from "@aponiajs/common";
import { eq, getTableName, sql, type SQL } from "drizzle-orm";
import type {
  IdOf,
  InsertOf,
  Repository,
  RepositoryDatabase,
  RepositoryQuery,
  RowOf,
  TableWithId,
} from "./repository.types.ts";

/**
 * Binds one Drizzle table to the narrow read and write surface a repository
 * exposes. The database instance keeps its own dialect; this package only owns
 * the shape of the operations.
 */
export function createRepository<TTable extends TableWithId>(
  database: object,
  table: TTable,
): Repository<TTable> {
  const query = database as unknown as RepositoryDatabase;
  if (typeof query.select !== "function") {
    throw new AponiaError("INVALID_DATABASE_OPTIONS", "A repository needs a selectable database.", {
      issues: Object.freeze(["database.select must be a function"]),
    });
  }

  return Object.freeze({
    table,
    findById: async (id: IdOf<TTable>) => {
      const rows = await query.select().from(table).where(eq(table.id, id));
      return freezeRow<TTable>(rows[0]);
    },
    findMany: async (options: RepositoryQuery = {}) => {
      if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
        throw invalidQuery("limit must be a positive integer");
      }
      if (
        options.offset !== undefined &&
        (!Number.isInteger(options.offset) || options.offset < 0)
      ) {
        throw invalidQuery("offset must be a non-negative integer");
      }
      let selected = query.select().from(table).where(options.where);
      if (options.orderBy !== undefined && options.orderBy.length > 0) {
        selected = selected.orderBy(...options.orderBy);
      }
      if (options.offset !== undefined) {
        selected = selected.offset(options.offset);
      }
      if (options.limit !== undefined) {
        selected = selected.limit(options.limit);
      }
      const rows = await selected;
      return Object.freeze(rows.map((row) => freezeRow<TTable>(row))).filter(
        (row): row is RowOf<TTable> => row !== undefined,
      );
    },
    count: async (options: { readonly where?: SQL | undefined } = {}) => {
      const rows = await query
        .select({ value: sql`count(*)` })
        .from(table)
        .where(options.where);
      const row = rows[0] as { readonly value?: unknown } | undefined;
      return Number(row?.value ?? 0);
    },
    exists: async (where?: SQL) => {
      const rows = await query.select().from(table).where(where).limit(1);
      return rows.length > 0;
    },
    insert: async (value: InsertOf<TTable>) => {
      const rows = await query.insert(table).values(value).returning();
      const row = freezeRow<TTable>(rows[0]);
      if (row === undefined) {
        throw new AponiaError("DATABASE_WRITE_FAILED", "The insert returned no row.", {
          table: getTableName(table),
        });
      }
      return row;
    },
    insertMany: async (values: readonly InsertOf<TTable>[]) => {
      if (values.length === 0) {
        return Object.freeze([]);
      }
      const rows = await query.insert(table).values(values).returning();
      return Object.freeze(
        rows
          .map((row) => freezeRow<TTable>(row))
          .filter((row): row is RowOf<TTable> => row !== undefined),
      );
    },
    update: async (id: IdOf<TTable>, value: Partial<InsertOf<TTable>>) => {
      const rows = await query.update(table).set(value).where(eq(table.id, id)).returning();
      return freezeRow<TTable>(rows[0]);
    },
    updateMany: async (options: {
      readonly where?: SQL | undefined;
      readonly value: Partial<InsertOf<TTable>>;
    }) => {
      const rows = await query.update(table).set(options.value).where(options.where).returning();
      return rows.length;
    },
    deleteById: async (id: IdOf<TTable>) => {
      const rows = await query.delete(table).where(eq(table.id, id)).returning();
      return rows.length > 0;
    },
    deleteMany: async (where?: SQL) => {
      const rows = await query.delete(table).where(where).returning();
      return rows.length;
    },
  });
}

function invalidQuery(issue: string): AponiaError {
  return new AponiaError("INVALID_DATABASE_OPTIONS", `The repository query is invalid: ${issue}.`, {
    issues: Object.freeze([issue]),
  });
}

function freezeRow<TTable extends TableWithId>(row: unknown): RowOf<TTable> | undefined {
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  return Object.freeze({ ...row }) as RowOf<TTable>;
}
