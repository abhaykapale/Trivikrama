import { z } from "zod";

import { ASSET_TYPES } from "../domain/asset.contracts.js";

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const hostname = z.string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iu)
  .nullable();
const ipAddress = z.union([z.ipv4(), z.ipv6()]).nullable();
const tags = z.array(z.string().trim().min(1).max(64)).max(50).refine(
  (values) => new Set(values.map((value) => value.toLowerCase())).size === values.length,
  "tags must be unique",
);
const metadata = z.record(z.string().max(100), z.unknown()).refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 32_768,
  "metadata must not exceed 32768 UTF-8 bytes",
);

export const assetIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const listAssetsQuerySchema = z.object({
  type: z.enum(ASSET_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  isActive: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const createAssetBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  assetType: z.enum(ASSET_TYPES),
  ipAddress: ipAddress.optional(),
  hostname: hostname.optional(),
  criticality: z.number().min(0).max(1).default(0.5),
  owner: nullableText(255).optional(),
  department: nullableText(255).optional(),
  tags: tags.default([]),
  metadata: metadata.default({}),
}).strict();

export const updateAssetBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  ipAddress: ipAddress.optional(),
  hostname: hostname.optional(),
  criticality: z.number().min(0).max(1).optional(),
  owner: nullableText(255).optional(),
  department: nullableText(255).optional(),
  tags: tags.optional(),
  metadata: metadata.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one field is required");

export const emptyAssetCommandBodySchema = z.object({}).strict();
