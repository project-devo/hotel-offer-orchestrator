import { setTimeout as sleep } from 'node:timers/promises';
import { Router } from 'express';
import supplierA from '../../data/supplierA.json';
import supplierB from '../../data/supplierB.json';
import { SUPPLIER_IDS, type SupplierHotel, type SupplierId } from '../../domain/types';
import type { SupplierStatus } from '../../redis/supplierStatus';

const DATA: Record<SupplierId, SupplierHotel[]> = { A: supplierA, B: supplierB };

export interface SuppliersRouteDeps {
  supplierStatus: Pick<SupplierStatus, 'isDown'>;
  latencyMs: number;
}

/** Mock supplier APIs served by the same process: GET /supplierA/hotels, GET /supplierB/hotels. */
export function suppliersRouter({ supplierStatus, latencyMs }: SuppliersRouteDeps): Router {
  const router = Router();

  for (const supplier of SUPPLIER_IDS) {
    router.get(`/supplier${supplier}/hotels`, async (req, res) => {
      if (latencyMs > 0) await sleep(latencyMs);

      // If Redis is unreachable the outage flag can't be read; keep serving rather than fail.
      const isDown = await supplierStatus.isDown(supplier).catch(() => false);
      if (isDown) {
        res.status(503).json({
          error: { code: 'SUPPLIER_DOWN', message: `Supplier ${supplier} is unavailable (simulated outage)` },
        });
        return;
      }

      const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : undefined;
      res.json(city ? DATA[supplier].filter((h) => h.city.toLowerCase() === city) : DATA[supplier]);
    });
  }

  return router;
}
