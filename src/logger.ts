import {createLogger, format, Logform, transport, transports} from "winston";

interface LoggerConfig {
    level: string;
    format: Logform.Format;
    transports: transport[];
}

const defaultConfig: LoggerConfig = {
    level: 'error',
    format: format.combine(
        format.json(),
        format.errors({ stack: true }),
        format.printf(({ level, message }) => {
            return `[${level.toUpperCase()}] ${message}`;
        })
    ),
    transports: [new transports.Console()]
};

let currentConfig: LoggerConfig = {...defaultConfig};

export const configureLogger = (options: Partial<LoggerConfig>): void => {
    currentConfig = {...currentConfig, ...options};
    logger.configure(currentConfig);
};

export const logger = createLogger(defaultConfig);