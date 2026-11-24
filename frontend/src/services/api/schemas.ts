import { z } from "zod";

const roleSchema = z.enum(["admin", "security_engineer", "soc_analyst"]);
const sessionUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email(),
  role: roleSchema,
  displayName: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
});

export const loginRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must contain at least 3 characters.")
    .max(100, "Username must contain at most 100 characters.")
    .regex(/^[A-Za-z0-9_]+$/u, "Use only letters, numbers, and underscores."),
  password: z
    .string()
    .min(12, "Password must contain at least 12 characters.")
    .max(128, "Password must contain at most 128 characters."),
});

export const loginResponseSchema = z
  .object({
    token: z.string().min(1),
    user: sessionUserSchema,
    expiresAt: z.string().min(1),
  })
  .transform(({ user, expiresAt }) => ({ user, expiresAt }));

export const currentUserResponseSchema = z.object({ user: sessionUserSchema });

export const refreshResponseSchema = z
  .object({ token: z.string().min(1), expiresAt: z.string().min(1) })
  .transform(({ expiresAt }) => ({ expiresAt }));

export const logoutResponseSchema = z.object({ message: z.literal("Logged out successfully") });

export type LoginRequest = z.infer<typeof loginRequestSchema>;
