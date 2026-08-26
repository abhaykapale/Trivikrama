import { z } from "zod";


const roleSchema = z.enum(["admin", "security_engineer", "soc_analyst"]);

const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters.")
  .max(128, "Password must contain at most 128 characters.")
  .regex(/[A-Z]/u, "Password must contain an uppercase letter.")
  .regex(/[a-z]/u, "Password must contain a lowercase letter.")
  .regex(/[0-9]/u, "Password must contain a number.")
  .regex(/[^A-Za-z0-9]/u, "Password must contain a special character.")
  .refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "Password must not exceed 72 UTF-8 bytes.",
  );

const isActiveSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const listUsersQuerySchema = z.object({
  role: roleSchema.optional(),

  isActive: isActiveSchema.optional(),

  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).default(25),

  search: z.string().trim().max(255).optional(),
});


export const getUserParamsSchema = z.object({
  id: z.string().trim().uuid("User ID must be a valid UUID."),
});

export const createUserBodySchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Username must contain at least 3 characters.")
      .max(100, "Username must contain at most 100 characters.")
      .regex(
        /^[A-Za-z0-9_]+$/u,
        "Username may contain letters, numbers, and underscores only.",
      ),
    email: z
      .string()
      .trim()
      .email("Email must be valid.")
      .max(255, "Email must contain at most 255 characters.")
      .transform((email) => email.toLowerCase()),
    password: passwordSchema,
    role: roleSchema,
    displayName: z
      .string()
      .trim()
      .min(1, "Display name must not be blank.")
      .max(255, "Display name must contain at most 255 characters.")
      .optional(),
  })
  .strict();

export const updateUserBodySchema = z
  .object({
    role: roleSchema.optional(),
    displayName: z
      .string()
      .trim()
      .min(1, "Display name must not be blank.")
      .max(255, "Display name must contain at most 255 characters.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((body) => body.role !== undefined || body.displayName !== undefined, {
    message: "Provide at least one field to update.",
  });

export const resetUserPasswordBodySchema = z
  .object({ newPassword: passwordSchema })
  .strict();

export type GetUserParams = z.infer<typeof getUserParamsSchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type ResetUserPasswordBody = z.infer<typeof resetUserPasswordBodySchema>;

export type UserParams = z.infer<typeof listUsersQuerySchema>;



/*

  limit: z.coerce.number().int().min(1).default(25),

  search: z.string().trim().max(255).optional(),
});

export type UserParams = z.infer<typeof listUsersQuerySchema>;


/*
    How it connects:

    validatedQuery = schema.parse(request.query)
        input = {
            ...validatedQuery,
            orgId: request.user.orgId
        }
    response = await listUsersUseCase.execute(input)
*/
