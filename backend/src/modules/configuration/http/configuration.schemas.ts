import { z } from "zod";

export const configurationKeyParamsSchema = z.object({
  key: z.string().trim().min(3).max(255).regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u),
}).strict();

export const updateConfigurationBodySchema = z.object({ value: z.json() }).strict().refine(
  (body) => Buffer.byteLength(JSON.stringify(body.value), "utf8") <= 32_768,
  { path: ["value"], message: "value must not exceed 32768 UTF-8 bytes" },
);
