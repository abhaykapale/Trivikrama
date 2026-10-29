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
import type { GetIncidentContextUseCase } from "../application/get-incident-context.use-case.js";
import type { ListIncidentAlertsUseCase } from "../application/list-incident-alerts.use-case.js";
import type { ListIncidentEventsUseCase } from "../application/list-incident-events.use-case.js";
import type { ListIncidentsUseCase } from "../application/list-incidents.use-case.js";
import type { AddIncidentNoteUseCase } from "../application/add-incident-note.use-case.js";
import type { ResolveIncidentUseCase } from "../application/resolve-incident.use-case.js";
import {
  IncidentAssigneeNotAvailableError,
  type AssignIncidentUseCase,
} from "../application/assign-incident.use-case.js";
import {
  InvalidIncidentStatusTransitionError,
  type TransitionIncidentStatusUseCase,
} from "../application/transition-incident-status.use-case.js";
import {
  incidentIdParamsSchema,
  addIncidentNoteBodySchema,
  assignIncidentBodySchema,
  incidentAlertsQuerySchema,
  incidentEventsQuerySchema,
  incidentTimelineQuerySchema,
  listIncidentsQuerySchema,
  resolveIncidentBodySchema,
  transitionIncidentStatusBodySchema,
} from "./incident-query.schemas.js";

export interface CreateIncidentQueryRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listIncidentsUseCase: Pick<ListIncidentsUseCase, "execute">;
  readonly getIncidentDetailUseCase: Pick<GetIncidentDetailUseCase, "execute">;
  readonly getIncidentContextUseCase?: Pick<GetIncidentContextUseCase, "execute">;
  readonly transitionIncidentStatusUseCase?: Pick<
    TransitionIncidentStatusUseCase,
    "execute"
  >;
  readonly assignIncidentUseCase?: Pick<AssignIncidentUseCase, "execute">;
  readonly addIncidentNoteUseCase?: Pick<AddIncidentNoteUseCase, "execute">;
  readonly resolveIncidentUseCase?: Pick<ResolveIncidentUseCase, "execute">;
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
  const assignmentSecurity = [
    authenticateRequest(dependencies.authentication),
    requirePermission("incidents.assign"),
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

  if (dependencies.getIncidentContextUseCase !== undefined) {
    router.get("/:id/context", ...security, async (request, response, next) => {
      await handleGetIncidentContext(request, response, next, dependencies);
    });
  }

  if (dependencies.transitionIncidentStatusUseCase !== undefined) {
    router.put("/:id/status", ...security, async (request, response, next) => {
      await handleTransitionIncidentStatus(request, response, next, dependencies);
    });
  }

  if (dependencies.assignIncidentUseCase !== undefined) {
    router.put(
      "/:id/assign",
      ...assignmentSecurity,
      async (request, response, next) => {
        await handleAssignIncident(request, response, next, dependencies);
      },
    );
  }

  if (dependencies.addIncidentNoteUseCase !== undefined) {
    router.post("/:id/notes", ...security, async (request, response, next) => {
      await handleAddIncidentNote(request, response, next, dependencies);
    });
  }

  if (dependencies.resolveIncidentUseCase !== undefined) {
    router.put("/:id/resolve", ...security, async (request, response, next) => {
      await handleResolveIncident(request, response, next, dependencies);
    });
  }

  router.get("/:id", ...security, async (request, response, next) => {
    await handleGetIncidentDetail(request, response, next, dependencies);
  });

  return router;
}

async function handleResolveIncident(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.resolveIncidentUseCase === undefined) {
      throw new Error("Incident-resolution dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const body = resolveIncidentBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.resolveIncidentUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      resolution: body.resolution,
      ...(body.note === undefined ? {} : { note: body.note }),
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident resolution request.", error);
      return;
    }
    if (error instanceof InvalidIncidentStatusTransitionError) {
      sendError(response, 422, error.code, error.message, {
        currentStatus: error.currentStatus,
        requestedStatus: error.requestedStatus,
      });
      return;
    }
    next(error);
  }
}

async function handleAddIncidentNote(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.addIncidentNoteUseCase === undefined) {
      throw new Error("Incident-note dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const body = addIncidentNoteBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.addIncidentNoteUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      content: body.content,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(201).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident note request.", error);
      return;
    }
    next(error);
  }
}

async function handleAssignIncident(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.assignIncidentUseCase === undefined) {
      throw new Error("Incident-assignment dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const body = assignIncidentBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.assignIncidentUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      assignedTo: body.assignedTo,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident assignment request.", error);
      return;
    }
    if (error instanceof IncidentAssigneeNotAvailableError) {
      sendError(
        response,
        404,
        error.code,
        "The requested incident assignee is not available.",
      );
      return;
    }
    next(error);
  }
}

async function handleTransitionIncidentStatus(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.transitionIncidentStatusUseCase === undefined) {
      throw new Error("Incident-status dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const body = transitionIncidentStatusBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.transitionIncidentStatusUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
      status: body.status,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident status request.", error);
      return;
    }
    if (error instanceof InvalidIncidentStatusTransitionError) {
      sendError(response, 422, error.code, error.message, {
        currentStatus: error.currentStatus,
        requestedStatus: error.requestedStatus,
      });
      return;
    }
    next(error);
  }
}

async function handleGetIncidentContext(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateIncidentQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.getIncidentContextUseCase === undefined) {
      throw new Error("Incident-context dependency is not configured.");
    }
    const { id } = incidentIdParamsSchema.parse(request.params);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.getIncidentContextUseCase.execute({
      incidentId: id,
      orgId: principal.orgId,
    });
    if (result === null) {
      sendIncidentNotFound(response, id);
      return;
    }
    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendValidationError(response, "Invalid incident context request.", error);
      return;
    }
    next(error);
  }
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
