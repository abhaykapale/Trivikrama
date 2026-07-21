import "./config/env.js";
import app from "./app.js";
import config from "./config/index.js";
import logger from "./shared/logger";
const PORT = config.server.port ;

const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});

export default server;