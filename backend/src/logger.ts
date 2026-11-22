import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'hotel-offer-orchestrator', mode: config.APP_MODE },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
});

export type Logger = typeof logger;
