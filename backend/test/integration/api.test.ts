import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { createApp } from '../../src/api/app';
import { AppError } from '../../src/api/errors';
import { createHealthCheck, type HealthReport } from '../../src/api/routes/health';
import { startServer, closeServer } from '../../src/api/server';
import { selectBestOffers } from '../../src/domain/selectBestOffers';
import type { SupplierHotel, SupplierId } from '../../src/domain/types';
import supplierA from '../../src/data/supplierA.json';
import supplierB from '../../src/data/supplierB.json';
import { logger } from '../../src/logger';
import { createHotelStore, type HotelStore } from '../../src/redis/hotelStore';
import { createSupplierStatus, type SupplierStatus } from '../../src/redis/supplierStatus';
import type { WorkflowRunner } from '../../src/temporal/client';
import { connectTestRedis } from './testRedis';

const DATA: Record<SupplierId, SupplierHotel[]> = { A: supplierA, B: supplierB };

let redis: Redis | null;
let store: HotelStore;
let status: SupplierStatus;
let failing: SupplierId[];
let runWorkflow: ReturnType<typeof vi.fn<WorkflowRunner>>;

/** Stand-in for the Temporal workflow: same selection + cache write, no Temporal needed. */
function fakeRunner() {
  let n = 0;
  return vi.fn<WorkflowRunner>(async (city) => {
    const ok = (['A', 'B'] as SupplierId[]).filter((s) => !failing.includes(s));
    if (ok.length === 0) throw new AppError(503, 'SUPPLIERS_UNAVAILABLE', 'All suppliers are currently unavailable');
    const hotels = selectBestOffers(ok.map((s) => ({ supplier: s, hotels: DATA[s].filter((h) => h.city === city) })));
    await store.saveHotels(city, hotels, failing);
    return { workflowId: `wf-${city}-${++n}`, result: { city, hotels, failedSuppliers: [...failing], fetchedAt: new Date().toISOString() } };
  });
}

const healthy: HealthReport = {
  status: 'ok',
  timestamp: new Date(0).toISOString(),
  uptimeSeconds: 1,
  suppliers: { supplierA: { status: 'up', latencyMs: 1 }, supplierB: { status: 'up', latencyMs: 1 } },
  dependencies: { redis: { status: 'up' }, temporal: { status: 'up' } },
};

const buildApp = () =>
  createApp({
    logger,
    hotelStore: store,
    supplierStatus: status,
    runWorkflow,
    healthCheck: async () => healthy,
    corsOrigins: ['http://localhost:5173'],
    supplierLatencyMs: 0,
    exposeErrors: false,
  });

beforeAll(async () => {
  redis = await connectTestRedis();
  if (redis) {
    store = createHotelStore(redis, { fullSeconds: 600, partialSeconds: 60 });
    status = createSupplierStatus(redis, 300);
  }
});
beforeEach(async () => {
  await redis?.flushdb();
  failing = [];
  runWorkflow = fakeRunner();
});
afterAll(async () => {
  await redis?.quit();
});

const requireRedis = (ctx: TestContext) => {
  if (!redis) ctx.skip();
};

describe('GET /api/hotels', () => {
  it('returns the deduped Delhi list in the exact response shape', async (ctx) => {
    requireRedis(ctx);
    const res = await request(buildApp()).get('/api/hotels?city=Delhi').expect(200);
    expect(res.body).toHaveLength(9);
    for (const item of res.body) expect(Object.keys(item).sort()).toEqual(['commissionPct', 'name', 'price', 'supplier']);
    expect(res.body[3]).toEqual({ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 });
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.headers['x-workflow-id']).toBe('wf-delhi-1');
    expect(res.headers['x-failed-suppliers']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(runWorkflow).toHaveBeenCalledWith('delhi');
  });

  it('runs the workflow on a filter cache miss, then serves hits from Redis', async (ctx) => {
    requireRedis(ctx);
    const app = buildApp();
    const miss = await request(app).get('/api/hotels?city=delhi&minPrice=4000&maxPrice=7000').expect(200);
    expect(miss.headers['x-cache']).toBe('MISS');
    expect(miss.body.map((h: { name: string }) => h.name)).toEqual(['Holtin', 'Radison']);

    const hit = await request(app).get('/api/hotels?city=delhi&minPrice=9000').expect(200);
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.headers['x-workflow-id']).toBeUndefined();
    expect(hit.body.map((h: { price: number }) => h.price)).toEqual([9800, 10950]);

    const hitMax = await request(app).get('/api/hotels?city=delhi&maxPrice=3000').expect(200);
    expect(hitMax.body).toHaveLength(2);
    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });

  it('returns [] for an unknown city and caches the empty result', async (ctx) => {
    requireRedis(ctx);
    const app = buildApp();
    await request(app).get('/api/hotels?city=atlantis').expect(200, []);
    const res = await request(app).get('/api/hotels?city=atlantis&minPrice=0').expect(200, []);
    expect(res.headers['x-cache']).toBe('HIT');
  });

  it('reports failed suppliers on partial results, including on cache hits', async (ctx) => {
    requireRedis(ctx);
    failing = ['B'];
    const app = buildApp();
    const res = await request(app).get('/api/hotels?city=delhi').expect(200);
    expect(res.headers['x-failed-suppliers']).toBe('B');
    expect(res.body.every((h: { supplier: string }) => h.supplier === 'Supplier A')).toBe(true);
    const hit = await request(app).get('/api/hotels?city=delhi&maxPrice=100000').expect(200);
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.headers['x-failed-suppliers']).toBe('B');
  });

  it('maps workflow errors to 503 with the error contract', async (ctx) => {
    requireRedis(ctx);
    failing = ['A', 'B'];
    const res = await request(buildApp()).get('/api/hotels?city=delhi').expect(503);
    expect(res.body).toEqual({ error: { code: 'SUPPLIERS_UNAVAILABLE', message: 'All suppliers are currently unavailable' } });
  });

  it('rejects invalid input with 400 VALIDATION_ERROR', async (ctx) => {
    requireRedis(ctx);
    const app = buildApp();
    const missing = await request(app).get('/api/hotels').expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details).toEqual([{ field: 'city', message: 'city is required' }]);
    const inverted = await request(app).get('/api/hotels?city=delhi&minPrice=8000&maxPrice=1000').expect(400);
    expect(inverted.body.error.code).toBe('VALIDATION_ERROR');
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('hides internal error messages behind 500 INTERNAL_ERROR', async (ctx) => {
    requireRedis(ctx);
    runWorkflow.mockRejectedValueOnce(new Error('secret internals'));
    const res = await request(buildApp()).get('/api/hotels?city=delhi').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
});

describe('mock suppliers and outage simulator', () => {
  it('serves supplier data filtered by city, case-insensitively', async (ctx) => {
    requireRedis(ctx);
    const app = buildApp();
    const a = await request(app).get('/supplierA/hotels?city=DELHI').expect(200);
    expect(a.body).toHaveLength(7);
    expect(a.body[0]).toEqual({ hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 });
    const all = await request(app).get('/supplierB/hotels').expect(200);
    expect(all.body).toHaveLength(supplierB.length);
    await request(app).get('/supplierB/hotels?city=atlantis').expect(200, []);
  });

  it('takes a supplier down and back up via the admin routes', async (ctx) => {
    requireRedis(ctx);
    const app = buildApp();
    const down = await request(app).post('/admin/suppliers/supplierb/down').expect(200);
    expect(down.body).toEqual({ supplier: 'B', status: 'down', autoRecoverSeconds: 300 });

    const blocked = await request(app).get('/supplierB/hotels?city=delhi').expect(503);
    expect(blocked.body.error.code).toBe('SUPPLIER_DOWN');

    const list = await request(app).get('/admin/suppliers').expect(200);
    expect(list.body.suppliers.A).toEqual({ status: 'up', ttlSeconds: null });
    expect(list.body.suppliers.B.status).toBe('down');
    expect(list.body.suppliers.B.ttlSeconds).toBeGreaterThan(0);

    await request(app).post('/admin/suppliers/B/up').expect(200, { supplier: 'B', status: 'up' });
    await request(app).get('/supplierB/hotels?city=delhi').expect(200);
    await request(app).post('/admin/suppliers/C/down').expect(400);
  });
});

describe('cross-cutting HTTP behaviour', () => {
  it('allows configured and Vercel origins and exposes custom headers', async (ctx) => {
    requireRedis(ctx);
    const app = buildApp();
    for (const origin of ['http://localhost:5173', 'https://hotel-offer-orchestrator.vercel.app', 'https://hotel-offer-orchestrator-git-main-x.vercel.app']) {
      const res = await request(app).get('/api/hotels?city=atlantis').set('Origin', origin).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-expose-headers']).toContain('X-Cache');
    }
    const other = await request(app).get('/api/hotels?city=atlantis').set('Origin', 'https://evil.example').expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app).options('/admin/suppliers/A/down').set('Origin', 'http://localhost:5173').expect(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
  });

  it('echoes a valid incoming X-Request-Id', async (ctx) => {
    requireRedis(ctx);
    const res = await request(buildApp()).get('/health/live').set('X-Request-Id', 'abc-123').expect(200, { status: 'ok' });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('returns 404 NOT_FOUND for unknown routes', async (ctx) => {
    requireRedis(ctx);
    const res = await request(buildApp()).get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /health (real supplier checks)', () => {
  let server: http.Server;
  let temporalUp = true;

  beforeAll(async () => {
    if (!redis) return;
    server = await startServer(buildApp(), 0);
  });
  afterAll(async () => {
    if (server) await closeServer(server);
  });

  const check = () =>
    createHealthCheck({
      supplierBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      pingRedis: () => redis!.ping(),
      checkTemporal: async () => {
        if (!temporalUp) throw new Error('connection refused');
      },
    })();

  it('reports ok, degraded and down', async (ctx) => {
    requireRedis(ctx);
    temporalUp = true;
    const ok = await check();
    expect(ok.status).toBe('ok');
    expect(ok.suppliers.supplierA.status).toBe('up');
    expect(ok.dependencies).toEqual({ redis: { status: 'up' }, temporal: { status: 'up' } });

    await status.setDown('B');
    const degraded = await check();
    expect(degraded.status).toBe('degraded');
    expect(degraded.suppliers.supplierB).toMatchObject({ status: 'down', error: 'HTTP 503' });

    await status.setDown('A');
    expect((await check()).status).toBe('down');

    await status.setUp('A');
    await status.setUp('B');
    temporalUp = false;
    const noTemporal = await check();
    expect(noTemporal.status).toBe('down');
    expect(noTemporal.dependencies.temporal).toEqual({ status: 'down', error: 'connection refused' });
  });

  it('serves 503 when the report is down', async (ctx) => {
    requireRedis(ctx);
    const app = createApp({
      logger,
      hotelStore: store,
      supplierStatus: status,
      runWorkflow,
      healthCheck: async () => ({ ...healthy, status: 'down' }),
      corsOrigins: [],
      supplierLatencyMs: 0,
      exposeErrors: false,
    });
    await request(app).get('/health').expect(503);
    await request(buildApp()).get('/health').expect(200);
  });
});
