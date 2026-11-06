import { Router, text as expressText, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  requirePermission,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import type { GetRuleDetailUseCase } from "../application/get-rule-detail.use-case.js";
import type { ListRulesUseCase } from "../application/list-rules.use-case.js";
import type { CreateRuleUseCase } from "../application/create-rule.use-case.js";
import type { UpdateRuleUseCase } from "../application/update-rule.use-case.js";
import type { ChangeRuleStatusUseCase } from "../application/change-rule-status.use-case.js";
import type { ArchiveRuleUseCase } from "../application/archive-rule.use-case.js";
import type { ImportRulesUseCase } from "../application/import-rules.use-case.js";
import type { DryRunRuleUseCase } from "../application/dry-run-rule.use-case.js";
import type { ExportRulesUseCase } from "../application/export-rules.use-case.js";
import {
  MAX_SIGMA_IMPORT_BYTES,
  CannotDeleteBuiltinRuleError,
  CannotModifyBuiltinRuleError,
  DuplicateSigmaRuleError,
  RuleCommandNotFoundError,
  RuleIdentityImmutableError,
  RuleStatusConflictError,
} from "../domain/rule-command.contracts.js";
import { RuleExportLimitExceededError } from "../domain/rule-operational.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";
import {
  createRuleBodySchema,
  emptyRuleCommandBodySchema,
  dryRunRuleBodySchema,
  exportRulesQuerySchema,
  listRulesQuerySchema,
  ruleIdParamsSchema,
  updateRuleBodySchema,
} from "./rule-query.schemas.js";

export interface CreateRuleQueryRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listRulesUseCase: Pick<ListRulesUseCase, "execute">;
  readonly getRuleDetailUseCase: Pick<GetRuleDetailUseCase, "execute">;
  readonly createRuleUseCase?: Pick<CreateRuleUseCase, "execute">;
  readonly updateRuleUseCase?: Pick<UpdateRuleUseCase, "execute">;
  readonly enableRuleUseCase?: Pick<ChangeRuleStatusUseCase, "execute">;
  readonly disableRuleUseCase?: Pick<ChangeRuleStatusUseCase, "execute">;
  readonly archiveRuleUseCase?: Pick<ArchiveRuleUseCase, "execute">;
  readonly importRulesUseCase?: Pick<ImportRulesUseCase, "execute">;
  readonly dryRunRuleUseCase?: Pick<DryRunRuleUseCase, "execute">;
  readonly exportRulesUseCase?: Pick<ExportRulesUseCase, "execute">;
}

export function createRuleQueryRouter(
  dependencies: CreateRuleQueryRouterDependencies,
): Router {
  const router = Router();
  const security = [
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.view"),
  ] as const;

  router.get("/", ...security, async (request, response, next) => {
    await handleList(request, response, next, dependencies);
  });
  router.get(
    "/export",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.export"),
    async (request, response, next) => {
      await handleExport(request, response, next, dependencies);
    },
  );
  router.post(
    "/",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.create"),
    async (request, response, next) => {
      await handleCreate(request, response, next, dependencies);
    },
  );
  router.post(
    "/import",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.import"),
    parseRuleImportBody,
    async (request, response, next) => {
      await handleImport(request, response, next, dependencies);
    },
  );
  router.put(
    "/:id/enable",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.enable"),
    async (request, response, next) => {
      await handleStatusChange(request, response, next, dependencies, "enable");
    },
  );
  router.post(
    "/:id/test",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.test"),
    async (request, response, next) => {
      await handleDryRun(request, response, next, dependencies);
    },
  );
  router.delete(
    "/:id",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.delete"),
    async (request, response, next) => {
      await handleArchive(request, response, next, dependencies);
    },
  );
  router.put(
    "/:id/disable",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.enable"),
    async (request, response, next) => {
      await handleStatusChange(request, response, next, dependencies, "disable");
    },
  );
  router.put(
    "/:id",
    authenticateRequest(dependencies.authentication),
    requirePermission("rules.edit"),
    async (request, response, next) => {
      await handleUpdate(request, response, next, dependencies);
    },
  );
  router.get("/:id", ...security, async (request, response, next) => {
    await handleDetail(request, response, next, dependencies);
  });

  return router;
}

const ruleImportTextParser = expressText({
  type: ["text/yaml", "application/yaml", "application/x-yaml"],
  limit: MAX_SIGMA_IMPORT_BYTES,
});

function parseRuleImportBody(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  ruleImportTextParser(request, response, (error?: unknown) => {
    if (isRequestTooLarge(error)) {
      sendError(response, 413, "RULE_IMPORT_TOO_LARGE", `Rule import must not exceed ${MAX_SIGMA_IMPORT_BYTES} bytes.`);
      return;
    }
    next(error);
  });
}

function isRequestTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}

async function handleImport(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.importRulesUseCase === undefined) {
      throw new Error("Rule-import dependency is not configured.");
    }
    if (typeof request.body !== "string") {
      sendError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Rule import requires text/yaml content.");
      return;
    }
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.importRulesUseCase.execute({
      orgId: principal.orgId,
      yamlContent: request.body,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    response.status(200).json(result);
  } catch (error: unknown) {
    handleRuleCommandError(error, response, next, "Invalid rule import request.");
  }
}

async function handleExport(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.exportRulesUseCase === undefined) {
      throw new Error("Rule-export dependency is not configured.");
    }
    const query = exportRulesQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.exportRulesUseCase.execute({
      orgId: principal.orgId,
      status: query.status,
    });
    response
      .status(200)
      .set({
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "text/yaml; charset=utf-8",
        "X-Rule-Count": String(result.count),
      })
      .send(result.content);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendRuleValidationResponse(response, "Invalid rule export parameters.", error);
      return;
    }
    if (error instanceof RuleExportLimitExceededError) {
      sendError(response, 413, error.code, error.message, { total: error.total });
      return;
    }
    next(error);
  }
}

async function handleDryRun(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.dryRunRuleUseCase === undefined) {
      throw new Error("Rule-dry-run dependency is not configured.");
    }
    const { id } = ruleIdParamsSchema.parse(request.params);
    const body = dryRunRuleBodySchema.parse(request.body ?? {});
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.dryRunRuleUseCase.execute({
      orgId: principal.orgId,
      ruleId: id,
      timeRangeSeconds: body.timeRangeSeconds,
      limit: body.limit,
    });
    response.status(200).json(result);
  } catch (error: unknown) {
    handleRuleCommandError(error, response, next, "Invalid rule dry-run request.");
  }
}

async function handleArchive(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.archiveRuleUseCase === undefined) {
      throw new Error("Rule-archive dependency is not configured.");
    }
    const { id } = ruleIdParamsSchema.parse(request.params);
    emptyRuleCommandBodySchema.parse(request.body ?? {});
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.archiveRuleUseCase.execute({
      orgId: principal.orgId,
      ruleId: id,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    response.status(200).json(result);
  } catch (error: unknown) {
    handleRuleCommandError(error, response, next, "Invalid rule archive request.");
  }
}

async function handleCreate(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.createRuleUseCase === undefined) {
      throw new Error("Rule-creation dependency is not configured.");
    }
    const body = createRuleBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const created = await dependencies.createRuleUseCase.execute({
      orgId: principal.orgId,
      yamlContent: body.yamlContent,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    response.status(201).json(created);
  } catch (error: unknown) {
    handleRuleCommandError(error, response, next, "Invalid rule creation request.");
  }
}

async function handleUpdate(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    if (dependencies.updateRuleUseCase === undefined) {
      throw new Error("Rule-update dependency is not configured.");
    }
    const { id } = ruleIdParamsSchema.parse(request.params);
    const body = updateRuleBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const updated = await dependencies.updateRuleUseCase.execute({
      orgId: principal.orgId,
      ruleId: id,
      yamlContent: body.yamlContent,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    response.status(200).json(updated);
  } catch (error: unknown) {
    handleRuleCommandError(error, response, next, "Invalid rule update request.");
  }
}

async function handleStatusChange(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
  operation: "enable" | "disable",
): Promise<void> {
  try {
    const useCase = operation === "enable"
      ? dependencies.enableRuleUseCase
      : dependencies.disableRuleUseCase;
    if (useCase === undefined) {
      throw new Error(`Rule-${operation} dependency is not configured.`);
    }
    const { id } = ruleIdParamsSchema.parse(request.params);
    emptyRuleCommandBodySchema.parse(request.body ?? {});
    const principal = requireAuthenticatedPrincipal(request);
    const result = await useCase.execute({
      orgId: principal.orgId,
      ruleId: id,
      actor: {
        id: principal.userId,
        username: principal.username,
        role: principal.role,
        ipAddress: request.ip ?? null,
      },
    });
    response.status(200).json(result);
  } catch (error: unknown) {
    handleRuleCommandError(error, response, next, `Invalid rule ${operation} request.`);
  }
}

function handleRuleCommandError(
  error: unknown,
  response: Response,
  next: NextFunction,
  validationMessage: string,
): void {
  if (error instanceof ZodError) {
    sendRuleValidationResponse(response, validationMessage, error);
    return;
  }
  if (error instanceof RuleValidationError) {
    sendError(response, 400, error.code, "Rule validation failed.", {
      errors: error.issues.map((issue) => `${issue.path}: ${issue.message}`),
      issues: error.issues,
    });
    return;
  }
  if (error instanceof DuplicateSigmaRuleError) {
    sendError(response, 409, error.code, error.message, {
      field: error.duplicateField,
      value: error.duplicateValue,
    });
    return;
  }
  if (error instanceof RuleCommandNotFoundError) {
    sendError(response, 404, error.code, error.message);
    return;
  }
  if (error instanceof CannotModifyBuiltinRuleError) {
    sendError(response, 403, error.code, error.message);
    return;
  }
  if (error instanceof CannotDeleteBuiltinRuleError) {
    sendError(response, 403, error.code, error.message);
    return;
  }
  if (error instanceof RuleIdentityImmutableError) {
    sendError(response, 409, error.code, error.message, {
      currentSigmaId: error.currentSigmaId,
      submittedSigmaId: error.submittedSigmaId,
    });
    return;
  }
  if (error instanceof RuleStatusConflictError) {
    sendError(response, 409, error.code, error.message, {
      currentStatus: error.currentStatus,
      requestedOperation: error.requestedOperation,
    });
    return;
  }
  next(error);
}

async function handleList(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    const query = listRulesQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.listRulesUseCase.execute({
      orgId: principal.orgId,
      ...query,
    });
    response.status(200).json(result);
  } catch (error: unknown) {
    handleRuleQueryError(error, response, next, "Invalid rule listing parameters.");
  }
}

async function handleDetail(
  request: Request,
  response: Response,
  next: NextFunction,
  dependencies: CreateRuleQueryRouterDependencies,
): Promise<void> {
  try {
    const { id } = ruleIdParamsSchema.parse(request.params);
    const principal = requireAuthenticatedPrincipal(request);
    const rule = await dependencies.getRuleDetailUseCase.execute({
      orgId: principal.orgId,
      ruleId: id,
    });
    if (rule === null) {
      sendError(response, 404, "RESOURCE_NOT_FOUND", `Rule with ID ${id} not found.`);
      return;
    }
    response.status(200).json(rule);
  } catch (error: unknown) {
    handleRuleQueryError(error, response, next, "Invalid rule ID.");
  }
}

function handleRuleQueryError(
  error: unknown,
  response: Response,
  next: NextFunction,
  message: string,
): void {
  if (error instanceof ZodError) {
    sendRuleValidationResponse(response, message, error);
    return;
  }
  next(error);
}

function sendRuleValidationResponse(
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
