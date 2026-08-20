import { z } from "zod";

export const supabaseUserIdSchema = z.string().uuid();

export const supabaseUserIdentitySchema = z
  .object({
    id: supabaseUserIdSchema,
    email: z.string().email().optional(),
  })
  .passthrough();

export const adminUserRowSchema = z.object({
  user_id: supabaseUserIdSchema,
});
