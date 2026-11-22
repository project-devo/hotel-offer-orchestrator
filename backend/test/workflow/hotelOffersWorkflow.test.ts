import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker, bundleWorkflowCode, type WorkflowBundleWithSourceMap } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { selectBestOffers } from '../../src/domain/selectBestOffers';
import type { HotelOffer, SupplierHotel, SupplierId } from '../../src/domain/types';
import supplierA from '../../src/data/supplierA.json';
import supplierB from '../../src/data/supplierB.json';
import type { Activities } from '../../src/temporal/activities';
import type { hotelOffersWorkflow } from '../../src/temporal/workflows';

const data: Record<SupplierId, SupplierHotel[]> = { A: supplierA, B: supplierB };
const delhi = (supplier: SupplierId) => data[supplier].filter((h) => h.city === 'delhi');

let env: TestWorkflowEnvironment;
let bundle: WorkflowBundleWithSourceMap;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN', () => undefined) });
  [env, bundle] = await Promise.all([
    TestWorkflowEnvironment.createLocal(),
    bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../../src/temporal/workflows.ts'),
      logger: new DefaultLogger('ERROR', () => undefined),
    }),
  ]);
});

afterAll(async () => {
  await env?.teardown();
});

function mockActivities(failing: SupplierId[] = []) {
  const saveHotelsToCache = vi.fn<Activities['saveHotelsToCache']>(async () => undefined);
  const fetchSupplierHotels = vi.fn<Activities['fetchSupplierHotels']>(async ({ supplier }) => {
    if (failing.includes(supplier)) throw new Error(`Supplier ${supplier} responded with HTTP 503`);
    return delhi(supplier);
  });
  return { fetchSupplierHotels, saveHotelsToCache };
}

async function runWorkflow(activities: ReturnType<typeof mockActivities>) {
  const taskQueue = `test-${randomUUID()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle: bundle,
    activities,
  });
  return worker.runUntil(
    env.client.workflow.execute<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
      taskQueue,
      workflowId: `test-${randomUUID()}`,
      args: [{ city: 'delhi' }],
    }),
  );
}

describe('hotelOffersWorkflow', () => {
  it('dedupes offers from both suppliers and saves them to the cache', async () => {
    const activities = mockActivities();
    const result = await runWorkflow(activities);

    const expected: HotelOffer[] = selectBestOffers([
      { supplier: 'A', hotels: delhi('A') },
      { supplier: 'B', hotels: delhi('B') },
    ]);
    expect(result.city).toBe('delhi');
    expect(result.failedSuppliers).toEqual([]);
    expect(result.hotels).toEqual(expected);
    expect(result.hotels).toHaveLength(9);
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);

    expect(activities.fetchSupplierHotels).toHaveBeenCalledTimes(2);
    expect(activities.saveHotelsToCache).toHaveBeenCalledOnce();
    expect(activities.saveHotelsToCache).toHaveBeenCalledWith({ city: 'delhi', hotels: expected, failedSuppliers: [] });
  });

  it('returns a partial result when one supplier fails after retries', async () => {
    const activities = mockActivities(['B']);
    const result = await runWorkflow(activities);

    expect(result.failedSuppliers).toEqual(['B']);
    expect(result.hotels.length).toBeGreaterThan(0);
    expect(result.hotels.every((h) => h.supplier === 'Supplier A')).toBe(true);
    // 1 call for A + 3 attempts for B (maximumAttempts: 3).
    const bCalls = activities.fetchSupplierHotels.mock.calls.filter(([input]) => input.supplier === 'B');
    expect(bCalls).toHaveLength(3);
    expect(activities.saveHotelsToCache).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'delhi', failedSuppliers: ['B'] }),
    );
  });

  it('fails with AllSuppliersUnavailable when both suppliers fail', async () => {
    const activities = mockActivities(['A', 'B']);
    const error = await runWorkflow(activities).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(WorkflowFailedError);
    const cause = (error as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as ApplicationFailure).type).toBe('AllSuppliersUnavailable');
    expect(activities.saveHotelsToCache).not.toHaveBeenCalled();
  });
});
