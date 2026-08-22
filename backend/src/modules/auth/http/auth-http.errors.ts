import type { Response } from "express";
import {
  AUTH_APPLICATION_ERROR_CODES,
  isAuthApplicationError,
} from "../application/index.js";

export interface StandardErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

const GENERIC_INVALID_CREDENTIALS_MESSAGE = "Invalid username or password.";

export function sendError(
  response: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response<StandardErrorBody> {
  return response.status(statusCode).json({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function sendAuthApplicationError(
  response: Response,
  error: unknown,
): Response<StandardErrorBody> {
  if (!isAuthApplicationError(error)) {
    return sendError(
      response,
      500,
      "INTERNAL_SERVER_ERROR",
      "Something went wrong.",
    );
  }

  switch (error.code) {
    case AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS:
      return sendError(
        response,
        401,
        error.code,
        GENERIC_INVALID_CREDENTIALS_MESSAGE,
      );

    case AUTH_APPLICATION_ERROR_CODES.ACCOUNT_LOCKED:
      return sendError(response, 423, error.code, error.message, error.details);

    case AUTH_APPLICATION_ERROR_CODES.USER_INACTIVE:
      return sendError(response, 403, error.code, error.message);

    case AUTH_APPLICATION_ERROR_CODES.SESSION_EXPIRED:
    case AUTH_APPLICATION_ERROR_CODES.SESSION_REVOKED:
    case AUTH_APPLICATION_ERROR_CODES.TOKEN_INVALID:
    case AUTH_APPLICATION_ERROR_CODES.USER_NOT_FOUND:
      return sendError(response, 401, error.code, error.message);

    default:
      return sendError(
        response,
        500,
        "INTERNAL_SERVER_ERROR",
        "Something went wrong.",
      );
  }
}
