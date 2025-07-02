import * as winston from 'winston';

interface LoggerConfig {
    level: string;
    format: winston.Logform.Format;
    transports: winston.transport[];
}

const defaultConfig: LoggerConfig = {
    level: 'info',
    format: winston.format.combine(
        winston.format.printf(logEntry =>
            `[${logEntry.level.toUpperCase()}] ${logEntry.message}`
        )
    ),
    transports: [new winston.transports.Console()]
};

let currentConfig: LoggerConfig = {...defaultConfig};

export const configureLogger = (options: Partial<LoggerConfig>): void => {
    currentConfig = {...currentConfig, ...options};
    logger.configure(currentConfig);
};

export const logger = winston.createLogger(defaultConfig);