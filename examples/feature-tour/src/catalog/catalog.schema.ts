import { t } from "elysia";
import { z } from "zod";

/**
 * Use case: route validation with two validator families at once. Zod arrives
 * through Standard Schema; Elysia's `t` is a platform-native validator.
 */
export const createItemSchema = {
  body: z.object({
    name: z.string().min(2),
    quantity: z.number().int().positive(),
  }),
};

export const searchItemsSchema = {
  query: t.Object({
    term: t.String({ minLength: 1 }),
    take: t.Optional(t.Numeric()),
  }),
};

export type CreateItem = z.infer<(typeof createItemSchema)["body"]>;
