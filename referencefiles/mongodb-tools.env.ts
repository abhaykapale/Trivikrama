import "dotenv/config";
import { z } from "zod";

const mongodbToolsEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  MONGODB_URI: z.string().min(1),
  MONGODB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  MONGODB_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export interface MongoDbToolsConfig {
  readonly nodeEnv: "development" | "production" | "test";
  readonly uri: string;
  readonly poolSize: number;
  readonly serverSelectionTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly socketTimeoutMs: number;
}

export function loadMongoDbToolsConfig(): MongoDbToolsConfig {
  const parsed = mongodbToolsEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `MongoDB tools environment validation failed: ${JSON.stringify(parsed.error.format())}`,
    );
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    uri: env.MONGODB_URI,
    poolSize: env.MONGODB_POOL_SIZE,
    serverSelectionTimeoutMs: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMs: env.MONGODB_CONNECT_TIMEOUT_MS,
    socketTimeoutMs: env.MONGODB_SOCKET_TIMEOUT_MS,
  };
}
