import { z } from "zod";

/** Zod arrives through Standard Schema. */
export const createItemSchema = {
  body: z.object({
    name: z.string().min(2),
    quantity: z.number().int().positive(),
  }),
};

export type CreateItem = z.infer<(typeof createItemSchema)["body"]>;
