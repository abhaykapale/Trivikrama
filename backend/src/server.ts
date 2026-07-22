import app from "./app.js";
import config from "./config";
import logger from "./shared/logger";

const startServer = (): void => {
  const port = config.server.port;

  app.listen(port, () => {
    logger.info(`🚀 Server running on port ${port}`);
  });
};

export default startServer;
