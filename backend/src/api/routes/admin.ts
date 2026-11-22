import { Router } from 'express';
import type { SupplierId } from '../../domain/types';
import type { SupplierStatus } from '../../redis/supplierStatus';
import { AppError, viaRedis } from '../errors';

/** Accepts A, B, supplierA, supplierB (case-insensitive). */
function parseSupplier(raw: string): SupplierId {
  const match = /^(?:supplier)?([ab])$/i.exec(raw);
  if (!match) {
    throw new AppError(400, 'VALIDATION_ERROR', 'supplier must be one of A, B, supplierA, supplierB');
  }
  return match[1]!.toUpperCase() as SupplierId;
}

/**
 * Outage simulator for demos. Deliberately unauthenticated; a "down" flag expires
 * on its own after SUPPLIER_DOWN_TTL_SECONDS.
 */
export function adminRouter(supplierStatus: SupplierStatus): Router {
  const router = Router();

  router.get('/admin/suppliers', async (_req, res) => {
    res.json({ suppliers: await viaRedis(() => supplierStatus.getAll()) });
  });

  router.post('/admin/suppliers/:supplier/down', async (req, res) => {
    const supplier = parseSupplier(req.params.supplier);
    await viaRedis(() => supplierStatus.setDown(supplier));
    req.log.warn({ supplier, autoRecoverSeconds: supplierStatus.downTtlSeconds }, 'Simulated supplier outage enabled');
    res.json({ supplier, status: 'down', autoRecoverSeconds: supplierStatus.downTtlSeconds });
  });

  router.post('/admin/suppliers/:supplier/up', async (req, res) => {
    const supplier = parseSupplier(req.params.supplier);
    await viaRedis(() => supplierStatus.setUp(supplier));
    req.log.info({ supplier }, 'Simulated supplier outage cleared');
    res.json({ supplier, status: 'up' });
  });

  return router;
}
