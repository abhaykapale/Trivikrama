import { Router } from "express";
import HealthController from "./health.controller.js";

const healthRouter = Router();

healthRouter.get("/health", HealthController.getHealth);

export default healthRouter;