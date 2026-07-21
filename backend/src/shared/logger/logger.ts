import winston from "winston";
import config from "../../config";

const isDevelopment = config.server.nodeEnv === "development";

const developmentFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({
        format: "HH:mm:ss"
    }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level} ${message}`;
    })
);

const productionFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const logger = winston.createLogger({
    level: isDevelopment ? "debug" : "info",

    format: isDevelopment
        ? developmentFormat
        : productionFormat,

    transports: [
        new winston.transports.Console()
    ]
});

export default logger;