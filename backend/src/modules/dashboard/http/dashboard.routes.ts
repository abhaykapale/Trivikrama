import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { authenticateRequest, requireAuthenticatedPrincipal, requirePermission, type AuthenticateRequestDependencies } from "../../auth/http/index.js";
import { sendError } from "../../auth/http/auth-http.errors.js";
import { DashboardIntervalTooFineError } from "../application/dashboard-window.js";
import type { GetDashboardSourceBreakdownUseCase } from "../application/get-dashboard-source-breakdown.use-case.js";
import type { GetDashboardSummaryUseCase } from "../application/get-dashboard-summary.use-case.js";
import type { GetDashboardTimelineUseCase } from "../application/get-dashboard-timeline.use-case.js";
import type { GetDashboardTopAssetsUseCase } from "../application/get-dashboard-top-assets.use-case.js";
import { dashboardRangeQuerySchema, dashboardTimelineQuerySchema, dashboardTopAssetsQuerySchema } from "./dashboard.schemas.js";

export interface CreateDashboardRouterDependencies {
  readonly authentication: AuthenticateRequestDependencies;
  readonly getDashboardSummaryUseCase: Pick<GetDashboardSummaryUseCase, "execute">;
  readonly getDashboardTimelineUseCase: Pick<GetDashboardTimelineUseCase, "execute">;
  readonly getDashboardTopAssetsUseCase: Pick<GetDashboardTopAssetsUseCase, "execute">;
  readonly getDashboardSourceBreakdownUseCase: Pick<GetDashboardSourceBreakdownUseCase, "execute">;
}

export function createDashboardRouter(dependencies: CreateDashboardRouterDependencies): Router {
  const router = Router();
  const security = [authenticateRequest(dependencies.authentication), requirePermission("dashboard.view")] as const;
  router.get("/summary", ...security, async (request, response, next) => handleSummary(request, response, next, dependencies));
  router.get("/timeline", ...security, async (request, response, next) => handleTimeline(request, response, next, dependencies));
  router.get("/top-assets", ...security, async (request, response, next) => handleTopAssets(request, response, next, dependencies));
  router.get("/source-breakdown", ...security, async (request, response, next) => handleSourceBreakdown(request, response, next, dependencies));
  return router;
}

async function handleSummary(request: Request, response: Response, next: NextFunction, dependencies: CreateDashboardRouterDependencies): Promise<void> {
  try {
    const query = dashboardRangeQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    sendPrivate(response, await dependencies.getDashboardSummaryUseCase.execute({ orgId: principal.orgId, range: query.range }));
  } catch (error: unknown) { handleError(error, response, next); }
}
async function handleTimeline(request: Request, response: Response, next: NextFunction, dependencies: CreateDashboardRouterDependencies): Promise<void> {
  try {
    const query = dashboardTimelineQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    sendPrivate(response, await dependencies.getDashboardTimelineUseCase.execute({ orgId: principal.orgId, range: query.range, ...(query.interval === undefined ? {} : { interval: query.interval }) }));
  } catch (error: unknown) { handleError(error, response, next); }
}
async function handleTopAssets(request: Request, response: Response, next: NextFunction, dependencies: CreateDashboardRouterDependencies): Promise<void> {
  try {
    const query = dashboardTopAssetsQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    sendPrivate(response, await dependencies.getDashboardTopAssetsUseCase.execute({ orgId: principal.orgId, range: query.range, limit: query.limit }));
  } catch (error: unknown) { handleError(error, response, next); }
}
async function handleSourceBreakdown(request: Request, response: Response, next: NextFunction, dependencies: CreateDashboardRouterDependencies): Promise<void> {
  try {
    const query = dashboardRangeQuerySchema.parse(request.query);
    const principal = requireAuthenticatedPrincipal(request);
    sendPrivate(response, await dependencies.getDashboardSourceBreakdownUseCase.execute({ orgId: principal.orgId, range: query.range }));
  } catch (error: unknown) { handleError(error, response, next); }
}
function sendPrivate(response: Response, body: unknown): void { response.status(200).set("Cache-Control", "private, no-store").json(body); }
function handleError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof ZodError) {
    sendError(response, 400, "VALIDATION_ERROR", "Invalid dashboard parameters.", { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    return;
  }
  if (error instanceof DashboardIntervalTooFineError) {
    sendError(response, 400, error.code, error.message, { range: error.range, interval: error.interval, buckets: error.buckets });
    return;
  }
  next(error);
}
