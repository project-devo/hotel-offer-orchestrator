import { Router } from 'express';
import type { HotelOffer, SupplierId } from '../../domain/types';
import type { HotelStore } from '../../redis/hotelStore';
import type { WorkflowRunner } from '../../temporal/client';
import { viaRedis } from '../errors';
import { parseHotelQuery } from '../validation';

export interface HotelsRouteDeps {
  hotelStore: Pick<HotelStore, 'getMeta' | 'filterByPrice'>;
  runWorkflow: WorkflowRunner;
}

export function hotelsRouter({ hotelStore, runWorkflow }: HotelsRouteDeps): Router {
  const router = Router();

  router.get('/api/hotels', async (req, res) => {
    const startedAt = Date.now();
    const { city, minPrice, maxPrice } = parseHotelQuery(req.query);
    const isFiltered = minPrice !== undefined || maxPrice !== undefined;

    let hotels: HotelOffer[];
    let cache: 'HIT' | 'MISS' = 'MISS';
    let workflowId: string | undefined;
    let failedSuppliers: SupplierId[];

    if (!isFiltered) {
      // Unfiltered requests always run the workflow, which also refreshes the cache.
      const run = await runWorkflow(city);
      ({ workflowId } = run);
      ({ hotels, failedSuppliers } = run.result);
    } else {
      const meta = await viaRedis(() => hotelStore.getMeta(city));
      if (meta) {
        cache = 'HIT';
        failedSuppliers = meta.failedSuppliers;
      } else {
        const run = await runWorkflow(city); // fills the cache
        ({ workflowId } = run);
        ({ failedSuppliers } = run.result);
      }
      hotels = await viaRedis(() => hotelStore.filterByPrice(city, minPrice, maxPrice));
    }

    res.setHeader('X-Cache', cache);
    if (workflowId) res.setHeader('X-Workflow-Id', workflowId);
    if (failedSuppliers.length > 0) res.setHeader('X-Failed-Suppliers', failedSuppliers.join(','));

    req.log.info(
      { city, minPrice, maxPrice, workflowId, cache, failedSuppliers, count: hotels.length, durationMs: Date.now() - startedAt },
      'Hotels request served',
    );
    res.json(hotels);
  });

  return router;
}
