import type Redis from 'ioredis';
import { SUPPLIER_IDS, type SupplierId } from '../domain/types';

const statusKey = (supplier: SupplierId) => `supplier:status:${supplier}`;

export interface SupplierFlag {
  status: 'up' | 'down';
  ttlSeconds: number | null;
}

/** Simulated outage flags for the mock suppliers. A flag expires on its own (auto-recovery). */
export function createSupplierStatus(redis: Redis, downTtlSeconds: number) {
  return {
    downTtlSeconds,

    async setDown(supplier: SupplierId): Promise<void> {
      await redis.set(statusKey(supplier), 'down', 'EX', downTtlSeconds);
    },

    async setUp(supplier: SupplierId): Promise<void> {
      await redis.del(statusKey(supplier));
    },

    async isDown(supplier: SupplierId): Promise<boolean> {
      return (await redis.get(statusKey(supplier))) === 'down';
    },

    async getAll(): Promise<Record<SupplierId, SupplierFlag>> {
      const ttls = await Promise.all(SUPPLIER_IDS.map((s) => redis.ttl(statusKey(s))));
      const flag = (ttl: number | undefined): SupplierFlag =>
        ttl !== undefined && ttl > 0 ? { status: 'down', ttlSeconds: ttl } : { status: 'up', ttlSeconds: null };
      return { A: flag(ttls[0]), B: flag(ttls[1]) };
    },
  };
}

export type SupplierStatus = ReturnType<typeof createSupplierStatus>;
