import type { Response } from "express";

export interface ApiErrorDetails {
  readonly [key: string]: unknown;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: ApiErrorDetails;
  };
}

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface PaginationMetadata {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface PaginatedApiResponse<T> {
  readonly data: readonly T[];
  readonly pagination: PaginationMetadata;
}

export function createApiErrorResponse(
  code: string,
  message: string,
  details?: ApiErrorDetails,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function sendApiError(
  response: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: ApiErrorDetails,
): Response<ApiErrorResponse> {
  return response
    .status(statusCode)
    .json(createApiErrorResponse(code, message, details));
}

export function toValidationErrors(
  issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly message: string;
  }[],
): readonly ValidationError[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
