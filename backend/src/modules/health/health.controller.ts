import { Request, Response } from "express";
import healthService from "./health.service";

class HealthController {
  public async getHealth(_req: Request, res: Response): Promise<Response> {
    const health = await healthService.getHealth();

    return res.status(200).json(health);
  }
}

export default new HealthController();
