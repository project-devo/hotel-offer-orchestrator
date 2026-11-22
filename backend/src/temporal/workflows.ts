import { ActivityFailure, ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers } from '../domain/selectBestOffers';
import type { HotelOffersInput, HotelOffersResult, SupplierId, SupplierResult } from '../domain/types';
// Type-only import: activity code never enters the workflow bundle.
import type { Activities } from './activities';

const { fetchSupplierHotels } = proxyActivities<Activities>({
  startToCloseTimeout: '5s',
  retry: {
    initialInterval: '300ms',
    backoffCoefficient: 2,
    maximumInterval: '2s',
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['SupplierBadResponse'],
  },
});

const { saveHotelsToCache } = proxyActivities<Activities>({
  startToCloseTimeout: '5s',
  retry: { maximumAttempts: 3 },
});

const SUPPLIERS: SupplierId[] = ['A', 'B'];

function failureReason(err: unknown): string {
  if (err instanceof ActivityFailure && err.cause) return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch both suppliers in parallel, keep the best offer per hotel, persist the result to Redis.
 * One supplier failing yields a partial result; both failing fails the workflow.
 */
export async function hotelOffersWorkflow({ city }: HotelOffersInput): Promise<HotelOffersResult> {
  log.info('Hotel offers workflow started', { city });

  const settled = await Promise.allSettled(SUPPLIERS.map((supplier) => fetchSupplierHotels({ supplier, city })));

  const results: SupplierResult[] = [];
  const failedSuppliers: SupplierId[] = [];
  settled.forEach((outcome, i) => {
    const supplier = SUPPLIERS[i]!;
    if (outcome.status === 'fulfilled') {
      results.push({ supplier, hotels: outcome.value });
    } else {
      failedSuppliers.push(supplier);
      log.warn('Supplier unavailable', { city, supplier, reason: failureReason(outcome.reason) });
    }
  });

  if (results.length === 0) {
    log.error('All suppliers unavailable', { city });
    throw ApplicationFailure.nonRetryable('All suppliers unavailable', 'AllSuppliersUnavailable');
  }

  const hotels = selectBestOffers(results);
  await saveHotelsToCache({ city, hotels, failedSuppliers });

  log.info('Hotel offers workflow completed', { city, count: hotels.length, failedSuppliers });
  return { city, hotels, failedSuppliers, fetchedAt: new Date().toISOString() };
}
