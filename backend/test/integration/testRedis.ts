import Redis from 'ioredis';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';

/** Connects to a dedicated test database and flushes it, or returns null (tests then skip). */
export async function connectTestRedis(): Promise<Redis | null> {
  const redis = new Redis(TEST_REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.flushdb();
    return redis;
  } catch {
    redis.disconnect();
    console.warn(
      `\n[integration] Redis is not reachable at ${TEST_REDIS_URL}; skipping these tests.\n` +
        '              Start it with `docker compose up -d redis` or set TEST_REDIS_URL.\n',
    );
    return null;
  }
}
