import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  requirePermission,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import type { GetIncidentDetailUseCase } from "../application/get-incident-detail.use-case.js";
import type { GetIncidentTimelineUseCase } from "../application/get-incident-timeline.use-case.js";
import type { ListIncidentAlertsUseCase } from "../application/list-incident-alerts.use-case.js";
import type { ListIncidentEventsUseCase } from "../application/list-incident-events.use-case.js";
import type { ListIncidentsUseCase } from "../application/list-incidents.use-case.js";
import {
  incidentIdParamsSchema,
  incidentAlertsQuerySchema,
  incidentEventsQuerySchema,
  incidentTimelineQuerySchema,
  listIncidentsQuerySchema,
} from "./incident-query.schemas.js";

export interface CreateIncidentQueryRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listIncidentsUseCase: Pick<ListIncidentsUseCase, "execute">;
  readonly getIncidentDetailUseCase: Pick<GetIncidentDetailUseCase, "execute">;
  /** Optional only for compatibility with isolated INC-02A router tests. */
  readonly getIncidentTimelineUseCase?: Pick<
    GetIncidentTimelineUseCase,
    "execute"
  >;
  readonly listIncidentAlertsUseCase?: Pick<ListIncidentAlertsUseCase, "execute">;
  readonly listIncidentEventsUseCase?: Pick<ListIncidentEventsUseCase, "execute">;
}

export function createIncidentQueryRouter(
  dependencies: CreateIncidentQueryRouterDependencies,
): Router {
  const router = Router();
  const security = [
    authenticateRequest(dependencies.authentication),
    requirePermission("incidents.view"),
  ] as const;

  router.get("/", ...security, async (request, response, next) => {
    await handleListIncidents(request, response, next, dependencies);
  });

  if (dependencies.getIncidentTimelineUseCase !== undefined) {
    router.get("/:id/timeline", ...security, async (request, response, next) => {
      await handleGetIncidentTimeline(request, response, next, dependencies);
    });
  }

  if (dependencies.listIncidentAlertsUseCase !== undefined) {
    router.get("/:id/alerts", ...security, async (request, response, next) => {
      await handleListIncidentAlerts(request, response, next, dependencies);
    });
  }

  if (dependencies.listIncidentEventsUseCase !== undefined) {
    router.get("/:id/events", ...security, async (request, response, next) => {
      await handleListIncidentEvents(request, response, next, dependencies);
    });
  }

  router.get("/:id", ...security, async (request, response, next) => {
    await handleGetIncidentDetail(request, response, next, dependencies);
  });

  return router;
}

async function handleListIncidentAlerts(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.listIncidentAlertsUseCase === undefined) {
      throw new Error("Incident-alert dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const query = incidentAlertsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.listIncidentAlertsUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      type: query.type,
      page: query.page,
      limit: query.limit,
    });

    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident alert request.", error);
      return;
    }
    next(error);
  }
}

async function handleListIncidentEvents(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.listIncidentEventsUseCase === undefined) {
      throw new Error("Incident-event dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const query = incidentEventsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.listIncidentEventsUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      page: query.page,
      limit: query.limit,
    });

    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident event request.", error);
      return;
    }
    next(error);
  }
}

async function handleGetIncidentTimeline(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.getIncidentTimelineUseCase === undefined) {
      throw new Error("Incident-timeline dependency is not configured.");
    }

    const { id } = incidentIdParamsSchema.parse(request.params);
    const query = incidentTimelineQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.getIncidentTimelineUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      type: query.type,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });

    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }

    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident timeline request.", error);
      return;
    }

    next(error);
  }
}

function sendIncidentNotFound(response: Response, id: string): void {
  sendError(
    response,
    404,
    "RESOURCE_NOT_FOUND",
    `Incident with ID ${id} not found.`,
  );
}

async function handleListIncidents(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    const query = listIncidentsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.listIncidentsUseCase.execute({
      orgId: principal.orgId,
      page: query.page,
      limit: query.limit,
      status: query.status,
      severity: query.severity,
      source: query.source,
      assignedTo: query.assignedTo,
      search: query.search,
      createdFrom: query.from,
      createdTo: query.to,
      sort: query.sort,
      order: query.order,
    });

    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident query parameters.", error);
      return;
    }

    next(error);
  }
}

async function handleGetIncidentDetail(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    const { id } = incidentIdParamsSchema.parse(request.params);
    const principal = requireAuthenticatedPrincipal(request);
    const incident = await dependencies.getIncidentDetailUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
    });

    if (incident === null) {
      sendError(
        response,
        404,
        "RESOURCE_NOT_FOUND",
        `Incident with ID ${id} not found.`,
      );
      return;
    }

    response.status(200).json(incident);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident ID.", error);
      return;
    }

    next(error);
  }
}

function sendValidationError(
  response: Response,
  message: string,
  error: ZodError,
): void {
  sendError(response, 400, "VALIDATION_ERROR", message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
