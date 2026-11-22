import { Router } from 'express';
import type { SupplierId } from '../../domain/types';

type UpDown = 'up' | 'down';

export interface SupplierHealth {
  status: UpDown;
  latencyMs: number;
  error?: string;
}

export interface DependencyHealth {
  status: UpDown;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  suppliers: { supplierA: SupplierHealth; supplierB: SupplierHealth };
  dependencies: { redis: DependencyHealth; temporal: DependencyHealth };
}

export type HealthCheck = () => Promise<HealthReport>;

export interface HealthCheckDeps {
  supplierBaseUrl: string;
  pingRedis: () => Promise<unknown>;
  checkTemporal: () => Promise<unknown>;
  timeoutMs?: number;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs all checks in parallel, each bounded by `timeoutMs`. */
export function createHealthCheck({ supplierBaseUrl, pingRedis, checkTemporal, timeoutMs = 2000 }: HealthCheckDeps): HealthCheck {
  async function checkSupplier(supplier: SupplierId): Promise<SupplierHealth> {
    const startedAt = Date.now();
    try {
      const res = await fetch(`${supplierBaseUrl}/supplier${supplier}/hotels`, { signal: AbortSignal.timeout(timeoutMs) });
      await res.arrayBuffer();
      const latencyMs = Date.now() - startedAt;
      return res.ok ? { status: 'up', latencyMs } : { status: 'down', latencyMs, error: `HTTP ${res.status}` };
    } catch (err) {
      const error = err instanceof Error && err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : reason(err);
      return { status: 'down', latencyMs: Date.now() - startedAt, error };
    }
  }

  async function checkDependency(check: () => Promise<unknown>): Promise<DependencyHealth> {
    try {
      await withTimeout(check(), timeoutMs);
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', error: reason(err) };
    }
  }

  return async () => {
    const [supplierA, supplierB, redis, temporal] = await Promise.all([
      checkSupplier('A'),
      checkSupplier('B'),
      checkDependency(pingRedis),
      checkDependency(checkTemporal),
    ]);
    const suppliersDown = [supplierA, supplierB].filter((s) => s.status === 'down').length;
    const status =
      suppliersDown === 2 || redis.status === 'down' || temporal.status === 'down'
        ? 'down'
        : suppliersDown === 1
          ? 'degraded'
          : 'ok';
    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      suppliers: { supplierA, supplierB },
      dependencies: { redis, temporal },
    };
  };
}

export function healthRouter(healthCheck: HealthCheck): Router {
  const router = Router();

  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/health', async (_req, res) => {
    const report = await healthCheck();
    res.setHeader('Cache-Control', 'no-store');
    res.status(report.status === 'down' ? 503 : 200).json(report);
  });

  return router;
}
