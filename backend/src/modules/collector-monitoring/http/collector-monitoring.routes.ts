import { Router, type NextFunction, type Request, type Response } from "express";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import type { GetCollectorStatusUseCase } from "../application/get-collector-status.use-case.js";

export interface CreateCollectorMonitoringRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly getCollectorStatusUseCase: Pick<GetCollectorStatusUseCase, "execute">;
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

  return router;
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

