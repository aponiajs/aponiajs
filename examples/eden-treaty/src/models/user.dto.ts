import { createDto, type Infer } from "@aponiajs/common";
import { z } from "zod";

/**
 * Pure DTO models — notice they require NO route path.
 */
export const UserDto = createDto(
  z.object({
    id: z.number(),
    name: z.string(),
  }),
);
export type User = Infer<typeof UserDto>;

export const CreateUserDto = createDto(
  z.object({
    name: z.string().min(2),
  }),
);
export type CreateUserInput = Infer<typeof CreateUserDto>;
