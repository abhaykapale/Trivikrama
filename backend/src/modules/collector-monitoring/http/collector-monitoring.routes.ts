import { Router, type NextFunction, type Request, type Response } from "express";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  requireRole,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import type { GetCollectorStatusUseCase } from "../application/get-collector-status.use-case.js";
import type { ListQuarantinedFilesUseCase } from "../application/list-quarantined-files.use-case.js";
import type { RetryQuarantinedFileUseCase } from "../application/retry-quarantined-file.use-case.js";
import {
  isQuarantineRetryError,
  type QuarantineRetryError,
} from "../domain/quarantine-retry.errors.js";
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
  /** Optional only for compatibility with earlier isolated router tests. */
  readonly retryQuarantinedFileUseCase?: Pick<
    RetryQuarantinedFileUseCase,
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

  router.post(
    "/quarantine/:filename/retry",
    authenticateRequest(dependencies.authentication),
    requireRole("admin", "security_engineer"),
    async (request, response, next) => {
      await handleRetryQuarantinedFile(request, response, next, dependencies);
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

async function handleRetryQuarantinedFile(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateCollectorMonitoringRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.retryQuarantinedFileUseCase === undefined) {
      throw new Error("Quarantine-retry dependency is not configured.");
    }

    const filename = z.string().trim().min(1).max(512).parse(
      request.params.filename,
    );
    const result = await dependencies.retryQuarantinedFileUseCase.execute({
      filename,
    });

    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(response, 400, "VALIDATION_ERROR", "Invalid filename.");
      return;
    }

    if (isQuarantineRetryError(error)) {
      sendQuarantineRetryError(response, error);
      return;
    }

    next(error);
  }
}

function sendQuarantineRetryError(
  response: Response,
  error: QuarantineRetryError,
): void {
  switch (error.code) {
    case "INVALID_FILENAME":
      sendError(response, 400, error.code, error.message);
      return;
    case "QUARANTINE_FILE_NOT_FOUND":
      sendError(response, 404, error.code, error.message);
      return;
    case "REQUEUE_DESTINATION_EXISTS":
      sendError(response, 409, error.code, error.message);
      return;
    case "UNSAFE_HANDOFF_PATH":
      sendError(
        response,
        409,
        error.code,
        "The quarantine file cannot be retried safely.",
      );
      return;
    case "REQUEUE_FAILED":
      sendError(
        response,
        500,
        "INTERNAL_SERVER_ERROR",
        "Something went wrong.",
      );
  }
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
