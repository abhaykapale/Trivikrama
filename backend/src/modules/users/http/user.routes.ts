import { NextFunction, Router, type Request, type Response } from "express";

import { authenticateRequest, type AuthenticateRequestDependencies, requireAuthenticatedPrincipal, requirePermission } from "../../auth/http";
import { ListUsersUseCase } from "../application/use-case/list-users.use-case";
import type { ListUsersRequestDTO } from "../application/dto/user.dto";
import { getUserParamsSchema, listUsersQuerySchema } from "./user.schema";
import { ZodError } from "zod";
import {  sendError } from "../../auth/http/auth-http.errors";
import { AuthenticatedPrincipal } from "../../auth/http/authenticated-principal";
import { GetUserByIdUseCase } from "../application/use-case/list-getuser.use-case";

export interface CreateUsersRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listUsersUseCase: ListUsersUseCase;
  readonly getUserByIdUseCase: GetUserByIdUseCase;
}

export function createUsersRouter(
  dependencies: CreateUsersRouterDependencies,
): Router {
  const router = Router();

  router.get(
    "/",
    authenticateRequest(dependencies.authentication),
    requirePermission("users.manage"),
    async (request, response) => {
      await handleListUsers(request, response, dependencies);
    },
  );

  router.get(
    "/:id",
    authenticateRequest(dependencies.authentication),
    requirePermission("users.manage"),
    async (request, response, next: NextFunction) => {
      await handleSingleUser(request, response, next, dependencies);
    },
  );

  return router;
}

async function handleListUsers(
  req: Request,
  res: Response,
  dependencies: CreateUsersRouterDependencies,
): Promise<void> {

    try {

         const query = listUsersQuerySchema.parse(req.query);

         const authenticatedUser = requireAuthenticatedPrincipal(req) satisfies AuthenticatedPrincipal;

         const orgId = authenticatedUser.orgId;

         const validatedInput = {
           ...query,
           orgId,
         } satisfies ListUsersRequestDTO;

         const result = await dependencies.listUsersUseCase.execute(validatedInput);

        res.status(200).json(result);

    } catch (error: unknown) {
        if (error instanceof ZodError) {
          sendError(res, 400, "VALIDATION_ERROR", "Invalid query parameters.", {
            issues: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
          return;
      }
      sendError(res, 500, "INTERNAL_SERVER_ERROR", "Something went wrong.");

      }

}


async function handleSingleUser(
  req: Request,
  res: Response,
  next: NextFunction,
  dependencies: CreateUsersRouterDependencies,
): Promise<void> {
  try {
    const { id: userId } =
      getUserParamsSchema.parse(req.params);

    const authenticatedUser =
      requireAuthenticatedPrincipal(req);

    const result =
      await dependencies.getUserByIdUseCase.execute({
        userId,
        orgId: authenticatedUser.orgId,
      });

    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid route parameters.",
        {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
      return;
    }

    next(error);
  }
}

/**
USERS ROUTE EXECUTION

Route:
GET /

Mounted later at:
/api/v1/users

Middleware:
1. authenticateRequest
2. requirePermission("users.manage")
3. handleListUsers

Handler:
1. Parse query with Zod
2. Read principal from request.user
3. Get orgId from principal
4. Build ListUsersRequestDTO
5. Await ListUsersUseCase
6. Return 200 JSON

Error mapping:
ZodError → 400 VALIDATION_ERROR
Unexpected error → 500 INTERNAL_SERVER_ERROR

Important:
An async function returns a Promise.
Use await before serializing its result.

Common bug:
Empty route callback means the handler never runs and no response is sent.


 try
    query = validate request.query

    principal = require authenticated principal

    input =:
        orgId from principal
        page and limit from validated query
        optional filters from validated query

    result = await use case

    send status 200 with result

catch ZodError
    send 400 validation error with issues

catch unexpected error
    send generic 500 without internal details

 */
