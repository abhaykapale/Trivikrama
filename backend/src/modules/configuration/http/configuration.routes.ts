import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { authenticateRequest, requireAuthenticatedPrincipal, requirePermission, type AuthenticateRequestDependencies } from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import { roleHasPermission } from "../../auth/http/permissions.js";
import type { ListConfigurationUseCase } from "../application/list-configuration.use-case.js";
import type { UpdateConfigurationUseCase } from "../application/update-configuration.use-case.js";
import { AI_ANOMALY_THRESHOLD_KEY, ConfigurationKeyNotManagedError, InvalidConfigurationValueError } from "../domain/configuration.contracts.js";
import { configurationKeyParamsSchema, updateConfigurationBodySchema } from "./configuration.schemas.js";

export interface CreateConfigurationRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listConfigurationUseCase: Pick<ListConfigurationUseCase, "execute">;
  readonly updateConfigurationUseCase: Pick<UpdateConfigurationUseCase, "execute">;
}

export function createConfigurationRouter(dependencies: CreateConfigurationRouterDependencies): Router {
  const router = Router();
  router.get("/", authenticateRequest(dependencies.authentication), requirePermission("config.view"),
    async (_request, response, next) => {
      try { sendPrivate(response, await dependencies.listConfigurationUseCase.execute()); }
      catch (error: unknown) { next(error); }
    });
  router.put("/:key", authenticateRequest(dependencies.authentication),
    async (request, response, next) => handleUpdate(request, response, next, dependencies));
  return router;
}

async function handleUpdate(request: Request, response: Response, next: NextFunction, dependencies: CreateConfigurationRouterDependencies): Promise<void> {
  try {
    const { key } = configurationKeyParamsSchema.parse(request.params);
    const principal = requireAuthenticatedPrincipal(request);
    const permission = key === AI_ANOMALY_THRESHOLD_KEY ? "config.ai_threshold" : "config.modify";
    if (!roleHasPermission(principal.role, permission)) {
      sendError(response, 403, "FORBIDDEN", "Insufficient permissions.");
      return;
    }
    const body = updateConfigurationBodySchema.parse(request.body);
    const result = await dependencies.updateConfigurationUseCase.execute({
      key, value: body.value,
      actor: { id: principal.userId, username: principal.username, role: principal.role, ipAddress: request.ip ?? null, orgId: principal.orgId },
    });
    if (result === null) {
      sendError(response, 404, "RESOURCE_NOT_FOUND", `Configuration key ${key} was not found.`);
      return;
    }
    sendPrivate(response, result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(response, 400, "VALIDATION_ERROR", "Invalid configuration request.", { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
      return;
    }
    if (error instanceof InvalidConfigurationValueError) {
      sendError(response, 422, error.code, error.message, { key: error.key, issues: error.issues });
      return;
    }
    if (error instanceof ConfigurationKeyNotManagedError) {
      sendError(response, 422, error.code, error.message, { key: error.key });
      return;
    }
    next(error);
  }
}

function sendPrivate(response: Response, body: unknown): void { response.status(200).set("Cache-Control", "private, no-store").json(body); }
