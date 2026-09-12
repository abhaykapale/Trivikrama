import { Router, type NextFunction, type Request, type Response } from "express";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  requireRole,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import type { GetCollectorStatusUseCase } from "../application/get-collector-status.use-case.js";
import type { ListQuarantinedFilesUseCase } from "../application/list-quarantined-files.use-case.js";
import { z, ZodError } from "zod";
import { sendError } from "../../auth/http/auth-http.errors.js";

const listQuarantineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export interface CreateCollectorMonitoringRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly getCollectorStatusUseCase: Pick<GetCollectorStatusUseCase, "execute">;
  /** Optional only for compatibility with earlier isolated router tests. */
  readonly listQuarantinedFilesUseCase?: Pick<
    ListQuarantinedFilesUseCase,
    "execute"
  >;
}

export function createCollectorMonitoringRouter(
  dependencies: CreateCollectorMonitoringRouterDependencies,
): Router {
  const router = Router();

  router.get(
    "/status",
    authenticateRequest(dependencies.authentication),
    async (request, response, next) => {
      await handleGetCollectorStatus(request, response, next, dependencies);
    },
  );

  router.get(
    "/quarantine",
    authenticateRequest(dependencies.authentication),
    requireRole("admin", "security_engineer"),
    async (request, response, next) => {
      await handleListQuarantinedFiles(request, response, next, dependencies);
    },
  );

  return router;
}

async function handleListQuarantinedFiles(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateCollectorMonitoringRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.listQuarantinedFilesUseCase === undefined) {
      throw new Error("Quarantine-listing dependency is not configured.");
    }

    const query = listQuarantineQuerySchema.parse(request.query);
    const result = await dependencies.listQuarantinedFilesUseCase.execute(query);

    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(response, 400, "VALIDATION_ERROR", "Invalid request query.", {
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

async function handleGetCollectorStatus(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateCollectorMonitoringRouterDependencies,
): Promise<void> {
  try {
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.getCollectorStatusUseCase.execute({
      orgId: principal.orgId,
    });

    response.status(200).json(result);
  } catch (error: unknown) {
    next(error);
  }
}
