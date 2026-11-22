import type Redis from 'ioredis';
import type { Result } from 'ioredis';
import { nameKey } from '../domain/selectBestOffers';
import type { HotelOffer, SupplierId } from '../domain/types';

/**
 * Price filter executed inside Redis in one round-trip:
 * ZSET range by score (inclusive bounds, price ascending), then HMGET the stored JSON items.
 */
export const PRICE_FILTER_LUA = `
local names = redis.call('ZRANGE', KEYS[1], ARGV[1], ARGV[2], 'BYSCORE')
if #names == 0 then return {} end
return redis.call('HMGET', KEYS[2], unpack(names))
`;

declare module 'ioredis' {
  interface RedisCommander<Context> {
    hotelsByPrice(byPriceKey: string, dataKey: string, min: string, max: string): Result<(string | null)[], Context>;
  }
}

export interface CacheMeta {
  count: number;
  failedSuppliers: SupplierId[];
  fetchedAt: string;
}

export const hotelKeys = (city: string) => ({
  byPrice: `hotels:${city}:byPrice`,
  data: `hotels:${city}:data`,
  // Existence of the meta key marks a cache hit, including for cities with zero hotels.
  meta: `hotels:${city}:meta`,
});

export function createHotelStore(redis: Redis, ttl: { fullSeconds: number; partialSeconds: number }) {
  redis.defineCommand('hotelsByPrice', { numberOfKeys: 2, lua: PRICE_FILTER_LUA });

  return {
    /** Atomically replace the cached list for a city (MULTI/EXEC). */
    async saveHotels(city: string, hotels: HotelOffer[], failedSuppliers: SupplierId[]): Promise<void> {
      const keys = hotelKeys(city);
      const seconds = failedSuppliers.length > 0 ? ttl.partialSeconds : ttl.fullSeconds;
      const meta: CacheMeta = { count: hotels.length, failedSuppliers, fetchedAt: new Date().toISOString() };

      const tx = redis.multi().del(keys.byPrice, keys.data, keys.meta);
      if (hotels.length > 0) {
        tx.zadd(keys.byPrice, ...hotels.flatMap((h) => [h.price, nameKey(h.name)]));
        tx.hset(keys.data, Object.fromEntries(hotels.map((h) => [nameKey(h.name), JSON.stringify(h)])));
      }
      tx.set(keys.meta, JSON.stringify(meta))
        .expire(keys.byPrice, seconds)
        .expire(keys.data, seconds)
        .expire(keys.meta, seconds);

      const results = await tx.exec();
      const failed = results?.find(([err]) => err);
      if (!results || failed) throw failed?.[0] ?? new Error('Redis transaction aborted');
    },

    async getMeta(city: string): Promise<CacheMeta | null> {
      const raw = await redis.get(hotelKeys(city).meta);
      return raw ? (JSON.parse(raw) as CacheMeta) : null;
    },

    /** Inclusive bounds; omitted bounds are open-ended. Ordered by price ascending. */
    async filterByPrice(city: string, minPrice?: number, maxPrice?: number): Promise<HotelOffer[]> {
      const keys = hotelKeys(city);
      const rows = await redis.hotelsByPrice(
        keys.byPrice,
        keys.data,
        minPrice === undefined ? '-inf' : String(minPrice),
        maxPrice === undefined ? '+inf' : String(maxPrice),
      );
      return rows.filter((row): row is string => row !== null).map((row) => JSON.parse(row) as HotelOffer);
    },
  };
}

export type HotelStore = ReturnType<typeof createHotelStore>;
