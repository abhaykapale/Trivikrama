import { z } from "zod";

export const loginRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[A-Za-z0-9_]+$/u, "Username may contain letters, numbers, and underscores only."),
  password: z.string().min(12).max(128),
});

export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
