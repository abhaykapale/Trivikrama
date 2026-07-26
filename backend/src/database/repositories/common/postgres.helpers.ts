import type { Knex } from "knex";

import type { PageResult, PaginationOptions } from "./repository.types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Pagination limit must be a positive integer.");
  }

  return Math.min(limit, MAX_LIMIT);
}

export function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return DEFAULT_OFFSET;
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Pagination offset must be a non-negative integer.");
  }

  return offset;
}

export async function pageByLimitOffset<TRow, TRecord>(
  query: Knex.QueryBuilder,
  options: PaginationOptions,
  mapper: (row: TRow) => TRecord,
): Promise<PageResult<TRecord>> {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  const rows = (await query.limit(limit + 1).offset(offset)) as TRow[];
  const visibleRows = rows.slice(0, limit);

  return {
    items: visibleRows.map(mapper),
    limit,
    offset,
    hasMore: rows.length > limit,
  };
}

export function ensureNonBlank(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must not be blank.`);
  }

  return normalized;
}

export function toNullableDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

export function toRequiredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function parseJsonArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  return [];
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }

  return {};
}

export function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? null);
}
