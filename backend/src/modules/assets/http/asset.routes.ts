import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
  requirePermission,
  type AuthenticateRequestDependencies,
} from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import type { CreateAssetUseCase } from "../application/create-asset.use-case.js";
import type { DeactivateAssetUseCase } from "../application/deactivate-asset.use-case.js";
import type { GetAssetUseCase } from "../application/get-asset.use-case.js";
import type { ListAssetsUseCase } from "../application/list-assets.use-case.js";
import type { UpdateAssetUseCase } from "../application/update-asset.use-case.js";
import {
  assetIdParamsSchema,
  createAssetBodySchema,
  emptyAssetCommandBodySchema,
  listAssetsQuerySchema,
  updateAssetBodySchema,
} from "./asset.schemas.js";

export interface CreateAssetRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly listAssetsUseCase: Pick<ListAssetsUseCase, "execute">;
  readonly getAssetUseCase: Pick<GetAssetUseCase, "execute">;
  readonly createAssetUseCase: Pick<CreateAssetUseCase, "execute">;
  readonly updateAssetUseCase: Pick<UpdateAssetUseCase, "execute">;
  readonly deactivateAssetUseCase: Pick<DeactivateAssetUseCase, "execute">;
}

export function createAssetRouter(dependencies: CreateAssetRouterDependencies): Router {
  const router = Router();
  router.get("/", authenticateRequest(dependencies.authentication), requirePermission("assets.view"),
    async (request, response, next) => handleList(request, response, next, dependencies));
  router.post("/", authenticateRequest(dependencies.authentication), requirePermission("assets.create"),
    async (request, response, next) => handleCreate(request, response, next, dependencies));
  router.get("/:id", authenticateRequest(dependencies.authentication), requirePermission("assets.view"),
    async (request, response, next) => handleDetail(request, response, next, dependencies));
  router.put("/:id", authenticateRequest(dependencies.authentication), requirePermission("assets.edit"),
    async (request, response, next) => handleUpdate(request, response, next, dependencies));
  router.delete("/:id", authenticateRequest(dependencies.authentication), requirePermission("assets.delete"),
    async (request, response, next) => handleDeactivate(request, response, next, dependencies));
  return router;
}

async function handleList(request: Request, response: Response, next: NextFunction, dependencies: CreateAssetRouterDependencies): Promise<void> {
  try {
    const query = listAssetsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    response.status(200).json(await dependencies.listAssetsUseCase.execute({
      orgId: principal.orgId,
      assetType: query.type,
      search: query.search,
      isActive: query.isActive,
      page: query.page,
      limit: query.limit,
    }));
  } catch (error: unknown) { handleError(error, response, next); }
}

async function handleDetail(request: Request, response: Response, next: NextFunction, dependencies: CreateAssetRouterDependencies): Promise<void> {
  try {
    const { id } = assetIdParamsSchema.parse(request.params);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.getAssetUseCase.execute({ orgId: principal.orgId, assetId: id });
    if (result === null) { sendError(response, 404, "RESOURCE_NOT_FOUND", `Asset with ID ${id} not found.`); return; }
    response.status(200).json(result);
  } catch (error: unknown) { handleError(error, response, next); }
}

async function handleCreate(request: Request, response: Response, next: NextFunction, dependencies: CreateAssetRouterDependencies): Promise<void> {
  try {
    const body = createAssetBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    response.status(201).json(await dependencies.createAssetUseCase.execute({
      orgId: principal.orgId,
      asset: body,
      actor: actorFromRequest(request),
    }));
  } catch (error: unknown) { handleError(error, response, next); }
}

async function handleUpdate(request: Request, response: Response, next: NextFunction, dependencies: CreateAssetRouterDependencies): Promise<void> {
  try {
    const { id } = assetIdParamsSchema.parse(request.params);
    const body = updateAssetBodySchema.parse(request.body);
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.updateAssetUseCase.execute({
      orgId: principal.orgId,
      assetId: id,
      changes: body,
      actor: actorFromRequest(request),
    });
    if (result === null) { sendError(response, 404, "RESOURCE_NOT_FOUND", `Asset with ID ${id} not found.`); return; }
    response.status(200).json(result);
  } catch (error: unknown) { handleError(error, response, next); }
}

async function handleDeactivate(request: Request, response: Response, next: NextFunction, dependencies: CreateAssetRouterDependencies): Promise<void> {
  try {
    const { id } = assetIdParamsSchema.parse(request.params);
    emptyAssetCommandBodySchema.parse(request.body ?? {});
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.deactivateAssetUseCase.execute({
      orgId: principal.orgId,
      assetId: id,
      actor: actorFromRequest(request),
    });
    if (result === null) { sendError(response, 404, "RESOURCE_NOT_FOUND", `Asset with ID ${id} not found.`); return; }
    response.status(200).json(result);
  } catch (error: unknown) { handleError(error, response, next); }
}

function actorFromRequest(request: Request) {
  const principal = requireAuthenticatedPrincipal(request);
  return { id: principal.userId, username: principal.username, role: principal.role, ipAddress: request.ip ?? null };
}

function handleError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof ZodError) {
    sendError(response, 400, "VALIDATION_ERROR", "Invalid asset request.", {
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }
  next(error);
}
