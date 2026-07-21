import { Request, Response } from "express";
import healthService from "./health.service";

class HealthController {
    
    public getHealth(req: Request, res: Response): Response {
        const health = healthService.getHealth();

        return res.status(200).json(health);
    }
}

export default new HealthController();