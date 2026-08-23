import winston from "winston";
import config from "../../config/env.js";
import { redactLogRecordInPlace } from "./redaction.js";

const isDevelopment = config.server.nodeEnv === "development";
const usePrettyLogging = config.logging.format === "pretty";

const redactFormat = winston.format((info) => {
  redactLogRecordInPlace(info);
  return info;
})();

const developmentFormat = winston.format.combine(
  winston.format.errors({
    stack: true,
  }),
  redactFormat,
  winston.format.colorize(),
  winston.format.timestamp({
    format: "HH:mm:ss",
  }),
  winston.format.printf(({ timestamp, level, message, stack, ...metadata }) => {
    const renderedMessage = stack ?? message;

    const renderedMetadata =
      Object.keys(metadata).length > 0
        ? `\n${JSON.stringify(metadata, null, 2)}`
        : "";

    return `[${timestamp}] ${level}: ${renderedMessage}${renderedMetadata}`;
  }),
);

const productionFormat = winston.format.combine(
  winston.format.errors({
    stack: true,
  }),
  redactFormat,
  winston.format.timestamp(),
  winston.format.json(),
);

const logger = winston.createLogger({
  level: config.logging.level,
  format:
    isDevelopment && usePrettyLogging ? developmentFormat : productionFormat,
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

export default logger;
