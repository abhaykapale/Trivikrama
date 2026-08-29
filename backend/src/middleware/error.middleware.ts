import type { NextFunction, Request, Response } from "express";
import AppError from "../shared/errors/AppError.js";
import ErrorCodes from "../shared/errors/ErrorCodes.js";
import { createApiErrorResponse } from "../shared/http/api-contracts.js";
import logger from "../shared/logger/index.js";

const errorMiddleware = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): Response => {
  const error =
    err instanceof Error ? err : new Error("A non-Error value was thrown.");

  logger.error({
    method: req.method,
    url: req.originalUrl,
    message: error.message,
    stack: error.stack,
  });

  if (error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json(
        createApiErrorResponse(error.errorCode, error.message, error.details),
      );
  }

  return res
    .status(500)
    .json(
      createApiErrorResponse(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        "Something went wrong.",
      ),
    );
};

export default errorMiddleware;
