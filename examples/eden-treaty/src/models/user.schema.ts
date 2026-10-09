import { z } from "zod";

/**
 * Pure schemas directly using Zod — no wrappers, no decorators, zero boilerplate.
 */
export const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z.object({
  name: z.string().min(2),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
