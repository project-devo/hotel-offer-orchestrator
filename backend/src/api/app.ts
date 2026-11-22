import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../logger';
import type { HotelStore } from '../redis/hotelStore';
import type { SupplierStatus } from '../redis/supplierStatus';
import type { WorkflowRunner } from '../temporal/client';
import { AppError } from './errors';
import { adminRouter } from './routes/admin';
import { healthRouter, type HealthCheck } from './routes/health';
import { hotelsRouter } from './routes/hotels';
import { suppliersRouter } from './routes/suppliers';

export interface AppDeps {
  logger: Logger;
  hotelStore: Pick<HotelStore, 'getMeta' | 'filterByPrice'>;
  supplierStatus: SupplierStatus;
  runWorkflow: WorkflowRunner;
  healthCheck: HealthCheck;
  corsOrigins: string[];
  supplierLatencyMs: number;
  /** Include internal error messages in 500 responses (never in production). */
  exposeErrors: boolean;
}

/** Vercel production and preview deployments of the frontend. */
const VERCEL_ORIGIN = /^https:\/\/hotel-offer-orchestrator[a-z0-9-]*\.vercel\.app$/;
const EXPOSED_HEADERS = 'X-Cache, X-Workflow-Id, X-Failed-Suppliers, X-Request-Id';

function cors(allowed: string[]): RequestHandler {
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.headers.origin;
    if (!origin || !(allowed.includes(origin) || VERCEL_ORIGIN.test(origin))) return next();

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.sendStatus(204);
      return;
    }
    next();
  };
}

function errorHandler(exposeErrors: boolean): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof AppError) {
      if (err.status >= 500) req.log.warn({ err: err.cause ?? err, code: err.code }, err.message);
      res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
      });
      return;
    }

    // Errors raised by Express itself (e.g. a malformed URL) carry a 4xx status.
    const status = (err as { status?: unknown })?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({
        error: { code: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', message: 'Bad request' },
      });
      return;
    }

    req.log.error({ err }, 'Unhandled error');
    const message = exposeErrors && err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/health/live' },
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(cors(deps.corsOrigins));

  app.use(healthRouter(deps.healthCheck));
  app.use(suppliersRouter({ supplierStatus: deps.supplierStatus, latencyMs: deps.supplierLatencyMs }));
  app.use(hotelsRouter({ hotelStore: deps.hotelStore, runWorkflow: deps.runWorkflow }));
  app.use(adminRouter(deps.supplierStatus));

  app.use((req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
  });
  app.use(errorHandler(deps.exposeErrors));

  return app;
}
