import type { AnyColumn, InferInsertModel, InferSelectModel, SQL, Table } from "drizzle-orm";

/** A table whose primary key column is named `id`. */
export type TableWithId = Table & { readonly id: AnyColumn };

/** The row one table selects. */
export type RowOf<TTable extends Table> = InferSelectModel<TTable>;

/** The value one table's `id` column holds. */
export type IdOf<TTable extends TableWithId> = TTable["id"]["_"]["data"];

/** The value one table inserts. */
export type InsertOf<TTable extends Table> = InferInsertModel<TTable>;

/** Options one read accepts. */
export interface RepositoryQuery {
  readonly where?: SQL | undefined;
  /** Columns and expressions to order by, in order. */
  readonly orderBy?: readonly (SQL | AnyColumn)[];
  readonly limit?: number;
  /** Rows to skip, for pagination. */
  readonly offset?: number;
}

/** A condition a caller builds with Drizzle's own helpers. */
export type RepositoryCondition = SQL;

/** The Drizzle query surface a repository needs; the platform casts at this boundary. */
export interface RepositoryDatabase {
  select(fields?: Readonly<Record<string, SQL | AnyColumn>>): {
    from(table: Table): RepositorySelect;
  };
  insert(table: Table): {
    values(value: unknown): { returning(): PromiseLike<readonly unknown[]> };
  };
  update(table: Table): {
    set(value: unknown): {
      where(condition: SQL | undefined): { returning(): PromiseLike<readonly unknown[]> };
    };
  };
  delete(table: Table): {
    where(condition: SQL | undefined): { returning(): PromiseLike<readonly unknown[]> };
  };
}

/** The chain a read builds before it is awaited; the driver decides when it runs. */
export interface RepositorySelect extends PromiseLike<readonly unknown[]> {
  where(condition: SQL | undefined): RepositorySelect;
  orderBy(...columns: readonly (SQL | AnyColumn)[]): RepositorySelect;
  limit(count: number): RepositorySelect;
  offset(count: number): RepositorySelect;
}

/** The read and write operations one table exposes. */
export interface Repository<TTable extends TableWithId> {
  readonly table: TTable;
  findById(id: IdOf<TTable>): Promise<RowOf<TTable> | undefined>;
  findMany(query?: RepositoryQuery): Promise<readonly RowOf<TTable>[]>;
  /** The number of rows matching an optional condition. */
  count(query?: { readonly where?: SQL | undefined }): Promise<number>;
  /** Whether any row matches an optional condition. */
  exists(where?: SQL): Promise<boolean>;
  insert(value: InsertOf<TTable>): Promise<RowOf<TTable>>;
  insertMany(values: readonly InsertOf<TTable>[]): Promise<readonly RowOf<TTable>[]>;
  update(id: IdOf<TTable>, value: Partial<InsertOf<TTable>>): Promise<RowOf<TTable> | undefined>;
  /** Updates every matching row and answers how many changed. */
  updateMany(query: {
    readonly where?: SQL | undefined;
    readonly value: Partial<InsertOf<TTable>>;
  }): Promise<number>;
  deleteById(id: IdOf<TTable>): Promise<boolean>;
  /** Deletes every matching row and answers how many were removed. */
  deleteMany(where?: SQL): Promise<number>;
}
