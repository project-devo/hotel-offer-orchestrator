import { ApplicationFailure, Context, log } from '@temporalio/activity';
import { supplierHotelsSchema } from '../domain/schemas';
import type { HotelOffer, SupplierHotel, SupplierId } from '../domain/types';

export interface HotelCacheWriter {
  saveHotels(city: string, hotels: HotelOffer[], failedSuppliers: SupplierId[]): Promise<void>;
}

export interface ActivityDeps {
  supplierBaseUrl: string;
  supplierTimeoutMs: number;
  hotelStore: HotelCacheWriter;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createActivities({ supplierBaseUrl, supplierTimeoutMs, hotelStore }: ActivityDeps) {
  return {
    /**
     * 5xx, timeouts and network errors throw a plain Error (retried by the workflow's policy).
     * Other non-2xx responses or malformed bodies are non-retryable `SupplierBadResponse` failures.
     */
    async fetchSupplierHotels({ supplier, city }: { supplier: SupplierId; city: string }): Promise<SupplierHotel[]> {
      const { attempt } = Context.current().info;
      const url = `${supplierBaseUrl}/supplier${supplier}/hotels?city=${encodeURIComponent(city)}`;
      const startedAt = Date.now();
      log.info('Supplier fetch started', { supplier, city, attempt });

      try {
        let res: Response;
        try {
          res = await fetch(url, { signal: AbortSignal.timeout(supplierTimeoutMs) });
        } catch (err) {
          const reason = err instanceof Error && err.name === 'TimeoutError' ? `timed out after ${supplierTimeoutMs}ms` : errorMessage(err);
          throw new Error(`Supplier ${supplier} request failed: ${reason}`);
        }

        if (res.status >= 500) {
          throw new Error(`Supplier ${supplier} responded with HTTP ${res.status}`);
        }
        if (!res.ok) {
          throw ApplicationFailure.nonRetryable(`Supplier ${supplier} responded with HTTP ${res.status}`, 'SupplierBadResponse');
        }

        const body: unknown = await res.json().catch(() => undefined);
        const parsed = supplierHotelsSchema.safeParse(body);
        if (!parsed.success) {
          throw ApplicationFailure.nonRetryable(`Supplier ${supplier} returned an invalid payload`, 'SupplierBadResponse');
        }

        log.info('Supplier fetch succeeded', { supplier, city, attempt, count: parsed.data.length, durationMs: Date.now() - startedAt });
        return parsed.data;
      } catch (err) {
        log.warn('Supplier fetch failed', { supplier, city, attempt, durationMs: Date.now() - startedAt, error: errorMessage(err) });
        throw err;
      }
    },

    async saveHotelsToCache({
      city,
      hotels,
      failedSuppliers,
    }: {
      city: string;
      hotels: HotelOffer[];
      failedSuppliers: SupplierId[];
    }): Promise<void> {
      try {
        await hotelStore.saveHotels(city, hotels, failedSuppliers);
        log.info('Hotels cached', { city, count: hotels.length, failedSuppliers });
      } catch (err) {
        log.error('Caching hotels failed', { city, attempt: Context.current().info.attempt, error: errorMessage(err) });
        throw err;
      }
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
