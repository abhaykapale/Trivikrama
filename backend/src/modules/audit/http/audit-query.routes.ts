import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { authenticateRequest, requireAuthenticatedPrincipal, requirePermission, type AuthenticateRequestDependencies } from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import type { ListAuditLogsUseCase } from "../application/list-audit-logs.use-case.js";
import { InvalidAuditTimeRangeError } from "../domain/audit-query.contracts.js";
import { listAuditLogsQuerySchema } from "./audit-query.schemas.js";

export interface CreateAuditQueryRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listAuditLogsUseCase: Pick<ListAuditLogsUseCase, "execute">;
}

export function createAuditQueryRouter(dependencies: CreateAuditQueryRouterDependencies): Router {
  const router = Router();
  router.get("/", authenticateRequest(dependencies.authentication), requirePermission("audit.view"),
    async (request, response, next) => handleList(request, response, next, dependencies));
  return router;
}

async function handleList(request: Request, response: Response, next: NextFunction, dependencies: CreateAuditQueryRouterDependencies): Promise<void> {
  try {
    const query = listAuditLogsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.listAuditLogsUseCase.execute({
      orgId: principal.orgId,
      ...query,
    });
    response.status(200).set("Cache-Control", "private, no-store").json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(response, 400, "VALIDATION_ERROR", "Invalid audit log query.", {
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }
    if (error instanceof InvalidAuditTimeRangeError) {
      sendError(response, 400, error.code, error.message, { reason: error.reason });
      return;
    }
    next(error);
  }
}
