import { Pool } from "pg";
import config from "../../config";
import logger from "../../shared/logger";

const pool = new Pool({
  host: config.database.postgres.host,
  port: config.database.postgres.port,
  user: config.database.postgres.user,
  password: config.database.postgres.password,
  database: config.database.postgres.database,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const query = async <T>(
  text: string,
  params?: unknown[],
): Promise<T> => {
  const result = await pool.query(text, params);

  return result.rows as T;
};

export const connectPostgres = async (): Promise<void> => {
  try {
    const client = await pool.connect();

    logger.info("PostgreSQL connected successfully");

    client.release();
  } catch (error) {
    logger.error("Failed to connect to PostgreSQL");
    throw error;
}

};

export default pool;
