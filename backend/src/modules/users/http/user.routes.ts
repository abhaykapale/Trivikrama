import { NextFunction, Router, type Request, type Response } from "express";

import { authenticateRequest, type AuthenticateRequestDependencies, requireAuthenticatedPrincipal, requirePermission } from "../../auth/http";
import { ListUsersUseCase } from "../application/use-case/list-users.use-case";
import type { ListUsersRequestDTO } from "../application/dto/user.dto";
import {
  createUserBodySchema,
  getUserParamsSchema,
  listUsersQuerySchema,
  resetUserPasswordBodySchema,
  updateUserBodySchema,
} from "./user.schema";
import { ZodError } from "zod";
import {  sendError } from "../../auth/http/auth-http.errors";
import { AuthenticatedPrincipal } from "../../auth/http/authenticated-principal";
import { GetUserByIdUseCase } from "../application/use-case/list-getuser.use-case";
import { DeactivateUserByIdUseCase } from "../application/use-case/list-detactivate-user.use-case";
import { CreateUserUseCase } from "../application/use-case/create-user.use-case.js";
import { UpdateUserUseCase } from "../application/use-case/update-user.use-case.js";
import { ResetUserPasswordUseCase } from "../application/use-case/reset-user-password.use-case.js";

export interface CreateUsersRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listUsersUseCase: ListUsersUseCase;
  readonly getUserByIdUseCase: GetUserByIdUseCase;
  readonly deactivateUserByIdUseCase: DeactivateUserByIdUseCase;
  readonly createUserUseCase: Pick<CreateUserUseCase, "execute">;
  readonly updateUserUseCase?: Pick<UpdateUserUseCase, "execute">;
  readonly resetUserPasswordUseCase?: Pick<ResetUserPasswordUseCase, "execute">;
}

export function createUsersRouter(
  dependencies: CreateUsersRouterDependencies,
): Router {
  const router = Router();

  router.post(
    "/",
    authenticateRequest(dependencies.authentication),
    requirePermission("users.manage"),
    async (request, response, next: NextFunction) => {
      await handleCreateUser(request, response, next, dependencies);
    },
  );

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

  router.put(
    "/:id",
    authenticateRequest(dependencies.authentication),
    requirePermission("users.manage"),
    async (request, response, next: NextFunction) => {
      await handleUpdateUser(request, response, next, dependencies);
    },
  );

  router.put(
    "/:id/deactivate",
    authenticateRequest(dependencies.authentication),
    requirePermission("users.manage"),
    async (request, response, next: NextFunction) => {
      await handleDeactivateUser(request, response, next, dependencies);
    },
  );

  router.put(
    "/:id/reset-password",
    authenticateRequest(dependencies.authentication),
    requirePermission("users.manage"),
    async (request, response, next: NextFunction) => {
      await handleResetUserPassword(request, response, next, dependencies);
    },
  );

  return router;
}

async function handleUpdateUser(req: Request, res: Response, next: NextFunction, dependencies: CreateUsersRouterDependencies): Promise<void> {
  try {
    if (dependencies.updateUserUseCase === undefined) throw new Error("Update-user dependency is not configured.");
    const { id: userId } = getUserParamsSchema.parse(req.params);
    const body = updateUserBodySchema.parse(req.body);
    const principal = requireAuthenticatedPrincipal(req);
    const result = await dependencies.updateUserUseCase.execute({ ...body, userId, orgId: principal.orgId, actorId: principal.userId, actorUsername: principal.username, actorRole: principal.role, ipAddress: req.ip ?? null });
    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) { sendError(res, 400, "VALIDATION_ERROR", "Invalid request.", { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }); return; }
    next(error);
  }
}

async function handleResetUserPassword(req: Request, res: Response, next: NextFunction, dependencies: CreateUsersRouterDependencies): Promise<void> {
  try {
    if (dependencies.resetUserPasswordUseCase === undefined) throw new Error("Reset-password dependency is not configured.");
    const { id: userId } = getUserParamsSchema.parse(req.params);
    const body = resetUserPasswordBodySchema.parse(req.body);
    const principal = requireAuthenticatedPrincipal(req);
    const result = await dependencies.resetUserPasswordUseCase.execute({ userId, orgId: principal.orgId, newPassword: body.newPassword, actorId: principal.userId, actorUsername: principal.username, actorRole: principal.role, ipAddress: req.ip ?? null });
    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) { sendError(res, 400, "VALIDATION_ERROR", "Invalid request.", { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }); return; }
    next(error);
  }
}

async function handleCreateUser(
  req: Request,
  res: Response,
  next: NextFunction,
  dependencies: CreateUsersRouterDependencies,
): Promise<void> {
  try {
    const body = createUserBodySchema.parse(req.body);
    const principal = requireAuthenticatedPrincipal(req);

    const result = await dependencies.createUserUseCase.execute({
      ...body,
      orgId: principal.orgId,
      actorId: principal.userId,
      actorUsername: principal.username,
      actorRole: principal.role,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(res, 400, "VALIDATION_ERROR", "Invalid request body.", {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    next(error);
  }
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

async function handleDeactivateUser(
  req: Request,
  res: Response,
  next: NextFunction,
  dependencies: CreateUsersRouterDependencies,
): Promise<void> {
  try {
    const { id: userId } = getUserParamsSchema.parse(req.params);

    const authenticatedUser = requireAuthenticatedPrincipal(req);

    const result = await dependencies.deactivateUserByIdUseCase.execute({
      userId,
      orgId: authenticatedUser.orgId,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(res, 400, "VALIDATION_ERROR", "Invalid route parameters.", {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
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
