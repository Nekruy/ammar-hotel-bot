import winston from "winston";
export const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...m }) => {
      const meta = Object.keys(m).length ? " " + JSON.stringify(m) : "";
      return `${timestamp} [${level}] ${message}${meta}`;
    })
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.colorize({ all: true }) }),
  ],
});
