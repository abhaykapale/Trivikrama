import { z } from "zod";


const roleSchema = z.enum(["admin", "security_engineer", "soc_analyst"]);

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

export type GetUserParams = z.infer<typeof getUserParamsSchema>;

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
