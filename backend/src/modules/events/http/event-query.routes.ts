import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  requirePermission,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import type { ExportEventsUseCase } from "../application/export-events.use-case.js";
import type { GetEventDetailUseCase } from "../application/get-event-detail.use-case.js";
import type { SearchEventsUseCase } from "../application/search-events.use-case.js";
import { InvalidEventTimeRangeError } from "../domain/event-query.contracts.js";
import {
  eventIdParamsSchema,
  exportEventsQuerySchema,
  searchEventsQuerySchema,
} from "./event-query.schemas.js";

export interface CreateEventQueryRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly searchEventsUseCase: Pick<SearchEventsUseCase, "execute">;
  readonly getEventDetailUseCase: Pick<GetEventDetailUseCase, "execute">;
  readonly exportEventsUseCase: Pick<ExportEventsUseCase, "execute">;
}

export function createEventQueryRouter(
  dependencies: CreateEventQueryRouterDependencies,
): Router {
  const router = Router();
  const security = [
    authenticateRequest(dependencies.authentication),
    requirePermission("events.view"),
  ] as const;

  router.get("/", ...security, async (request, response, next) => {
    await handleSearch(request, response, next, dependencies);
  });
  router.get("/search", ...security, async (request, response, next) => {
    await handleSearch(request, response, next, dependencies);
  });
  router.get("/export", ...security, async (request, response, next) => {
    await handleExport(request, response, next, dependencies);
  });
  router.get("/:eventId", ...security, async (request, response, next) => {
    await handleDetail(request, response, next, dependencies);
  });

  return router;
}

async function handleSearch(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateEventQueryRouterDependencies,
): Promise<void> {
  try {
    const query = searchEventsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.searchEventsUseCase.execute({
      orgId: principal.orgId,
      ...query,
    });
    response.status(200).json(result);
  } catch (error: unknown) {
    handleQueryError(error, response, next, "Invalid event search parameters.");
  }
}

async function handleDetail(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateEventQueryRouterDependencies,
): Promise<void> {
  try {
    const { eventId } = eventIdParamsSchema.parse(request.params);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.getEventDetailUseCase.execute({
      eventId,
      orgId: principal.orgId,
    });

    if (result === null) {
      sendError(
        response,
        404,
        "RESOURCE_NOT_FOUND",
        `Event with ID ${eventId} not found.`,
      );
      return;
    }

    response.status(200).json(result);
  } catch (error: unknown) {
    handleQueryError(error, response, next, "Invalid event ID.");
  }
}

async function handleExport(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateEventQueryRouterDependencies,
): Promise<void> {
  try {
    const query = exportEventsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.exportEventsUseCase.execute({
      orgId: principal.orgId,
      ...query,
    });

    response.setHeader("Content-Type", result.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    response.setHeader("X-Exported-Count", String(result.exportedCount));
    response.setHeader("X-Export-Truncated", String(result.truncated));
    response.status(200).send(result.body);
  } catch (error: unknown) {
    handleQueryError(error, response, next, "Invalid event export parameters.");
  }
}

function handleQueryError(
  error: unknown,
  response: Response,
  next: NextFunction,
  message: string,
): void {
  if (error instanceof ZodError) {
    sendError(response, 400, "VALIDATION_ERROR", message, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof InvalidEventTimeRangeError) {
    sendError(response, 400, "VALIDATION_ERROR", message, {
      issues: [{ path: "from", message: error.message }],
    });
    return;
  }

  next(error);
}
