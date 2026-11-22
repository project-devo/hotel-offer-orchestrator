import type http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from './api/app';
import { createHealthCheck } from './api/routes/health';
import { closeServer, startServer } from './api/server';
import { config } from './config';
import { logger } from './logger';
import { createRedis } from './redis/client';
import { createHotelStore } from './redis/hotelStore';
import { createSupplierStatus } from './redis/supplierStatus';
import { createActivities } from './temporal/activities';
import { checkTemporal, closeTemporalClient, runHotelOffersWorkflow } from './temporal/client';
import { startWorker, type RunningWorker } from './temporal/worker';

const WORKER_CONNECT_ATTEMPTS = 20;

async function main(): Promise<void> {
  const mode = config.APP_MODE;
  logger.info(
    {
      mode,
      port: config.PORT,
      temporalAddress: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      supplierBaseUrl: config.SUPPLIER_BASE_URL,
    },
    'Starting hotel offer orchestrator',
  );

  const redis = createRedis(config.REDIS_URL, logger);
  const hotelStore = createHotelStore(redis, {
    fullSeconds: config.CACHE_TTL_SECONDS,
    partialSeconds: config.PARTIAL_CACHE_TTL_SECONDS,
  });

  let server: http.Server | undefined;
  let worker: RunningWorker | undefined;
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');
    setTimeout(() => process.exit(1), 15_000).unref();
    try {
      if (server) await closeServer(server);
      if (worker) await worker.shutdown().catch(() => undefined);
      await closeTemporalClient();
      await redis.quit().catch(() => redis.disconnect());
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      exitCode = 1;
    }
    process.exit(exitCode);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // In "all" mode the HTTP server starts first so health checks pass while the worker connects.
  if (mode !== 'worker') {
    const supplierStatus = createSupplierStatus(redis, config.SUPPLIER_DOWN_TTL_SECONDS);
    const app = createApp({
      logger,
      hotelStore,
      supplierStatus,
      runWorkflow: runHotelOffersWorkflow,
      healthCheck: createHealthCheck({
        supplierBaseUrl: config.SUPPLIER_BASE_URL,
        pingRedis: () => redis.ping(),
        checkTemporal,
      }),
      corsOrigins: config.CORS_ORIGINS,
      supplierLatencyMs: config.SUPPLIER_LATENCY_MS,
      exposeErrors: config.NODE_ENV !== 'production',
    });
    server = await startServer(app, config.PORT);
    logger.info({ port: config.PORT }, 'HTTP server listening');
  }

  if (mode !== 'api') {
    const activities = createActivities({
      supplierBaseUrl: config.SUPPLIER_BASE_URL,
      supplierTimeoutMs: config.SUPPLIER_TIMEOUT_MS,
      hotelStore,
    });
    for (let attempt = 1; !worker && !shuttingDown; attempt++) {
      try {
        worker = await startWorker(activities);
      } catch (err) {
        if (attempt >= WORKER_CONNECT_ATTEMPTS) throw err;
        logger.warn({ attempt, err: (err as Error).message }, 'Temporal not reachable yet; retrying worker start');
        await sleep(Math.min(1000 * attempt, 5000));
      }
    }
    worker?.done.catch((err: unknown) => {
      logger.fatal({ err }, 'Temporal worker stopped unexpectedly');
      void shutdown('worker-failure', 1);
    });
  }
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Startup failed');
  process.exit(1);
});
