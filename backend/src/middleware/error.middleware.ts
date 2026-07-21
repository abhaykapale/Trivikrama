import { NextFunction, Request, Response } from "express";
import AppError from "../shared/errors/AppError";
import ErrorCodes from "../shared/errors/ErrorCodes";
import logger from "../shared/logger";

const errorMiddleware = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): Response => {

    logger.error({
        method: req.method,
        url: req.originalUrl,
        message: err.message,
        stack: err.stack
    });

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: {
                code: err.errorCode,
                message: err.message
            }
        });
    }

    return res.status(500).json({
        success: false,
        error: {
            code: ErrorCodes.INTERNAL_SERVER_ERROR,
            message: "Something went wrong."
        }
    });
};

export default errorMiddleware;