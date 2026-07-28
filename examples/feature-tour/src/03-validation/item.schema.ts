import { t } from "elysia";
import { z } from "zod";

/** Zod arrives through Standard Schema. */
export const createItemSchema = {
  body: z.object({
    name: z.string().min(2),
    quantity: z.number().int().positive(),
  }),
};

/** Elysia's `t` is a platform-native validator, accepted without conversion. */
export const searchItemsSchema = {
  query: t.Object({
    term: t.String({ minLength: 1 }),
    take: t.Optional(t.Numeric()),
  }),
};

/** Headers and params validate through the same slots. */
export const tenantHeaderSchema = {
  headers: t.Object({ "x-tenant": t.String({ minLength: 2 }) }),
};

export type CreateItem = z.infer<(typeof createItemSchema)["body"]>;
