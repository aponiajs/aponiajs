import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The table the reference application owns. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  roles: text("roles").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type UserRow = typeof users.$inferSelect;
