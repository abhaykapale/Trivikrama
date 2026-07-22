import "./config/env.js";

import logger from "./shared/logger";
import startServer from "./server";

import { connectPostgres } from "./database/postgres";

const bootstrap = async (): Promise<void> => {
  try {
    logger.info("Starting Server...");

    
    await connectPostgres();

    startServer();

    logger.info("Server started successfully.");
  } catch (error) {
    logger.error(error);

    process.exit(1);
  }
};

bootstrap();
