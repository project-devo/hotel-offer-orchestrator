import Redis from 'ioredis';
import type { Logger } from '../logger';

export function createRedis(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    // Fail fast instead of queueing forever, so the API can answer 503 CACHE_UNAVAILABLE.
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
  });
  let healthy = false;
  redis.on('ready', () => {
    healthy = true;
    logger.info('Redis connected');
  });
  redis.on('error', (err: Error) => {
    // ioredis emits on every reconnect attempt; only log the transition to unhealthy.
    if (healthy) logger.warn({ err: err.message }, 'Redis connection lost');
    else logger.debug({ err: err.message }, 'Redis connection error');
    healthy = false;
  });
  return redis;
}
