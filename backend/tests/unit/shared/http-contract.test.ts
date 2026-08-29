import assert from "node:assert/strict";
import { test } from "node:test";

import type { Request } from "express";

import {
  createApiErrorResponse,
  toValidationErrors,
  type PaginatedApiResponse,
} from "../../../src/shared/http/api-contracts.js";
import { getRequestContext } from "../../../src/shared/http/request-context.js";

test("API error response omits details when none are provided", () => {
  assert.deepEqual(createApiErrorResponse("NOT_FOUND", "Resource not found."), {
    error: {
      code: "NOT_FOUND",
      message: "Resource not found.",
    },
  });
});

test("API error response preserves safe structured details", () => {
  assert.deepEqual(
    createApiErrorResponse("VALIDATION_ERROR", "Invalid request.", {
      issues: [{ path: "email", message: "Invalid email address" }],
    }),
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        details: {
          issues: [{ path: "email", message: "Invalid email address" }],
        },
      },
    },
  );
});

test("validation issues use stable dot-separated paths", () => {
  assert.deepEqual(
    toValidationErrors([
      { path: ["filters", 0, "value"], message: "Value is required" },
    ]),
    [{ path: "filters.0.value", message: "Value is required" }],
  );
});

test("pagination contract matches the documented list response", () => {
  const response = {
    data: [{ id: "user-1" }],
    pagination: {
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  } satisfies PaginatedApiResponse<{ readonly id: string }>;

  assert.equal(response.pagination.totalPages, 1);
});

test("request context normalizes IP address and user agent", () => {
  const request = {
    ip: "203.0.113.10",
    headers: { "user-agent": "contract-test-agent" },
  } as unknown as Request;

  assert.deepEqual(getRequestContext(request), {
    ipAddress: "203.0.113.10",
    userAgent: "contract-test-agent",
  });
});
