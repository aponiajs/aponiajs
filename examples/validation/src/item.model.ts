import { Validation, type InferValidatorOutput } from "@aponiajs/common";
import { t } from "elysia";
import { z } from "zod";

/* oxlint-disable typescript/no-unsafe-declaration-merging -- Validation models are metadata tokens for Elysia-validated plain objects; Aponia never constructs them. */

/** Zod arrives through Standard Schema. */
const createItemSchema = z.object({
  name: z.string().min(2),
  quantity: z.number().int().positive(),
});

/** Elysia's `t` is a platform-native validator, accepted without conversion. */
const searchItemsSchema = t.Object({
  term: t.String({ minLength: 1 }),
  take: t.Optional(t.Numeric()),
});

/** Headers validate through the same model contract. */
const tenantHeadersSchema = t.Object({
  "x-tenant": t.String({ minLength: 2 }),
});

@Validation(createItemSchema)
export class CreateItem {}
export interface CreateItem extends InferValidatorOutput<typeof createItemSchema> {}

@Validation(searchItemsSchema)
export class SearchItems {}
export interface SearchItems extends InferValidatorOutput<typeof searchItemsSchema> {}

@Validation(tenantHeadersSchema)
export class TenantHeaders {}
export interface TenantHeaders extends InferValidatorOutput<typeof tenantHeadersSchema> {}
