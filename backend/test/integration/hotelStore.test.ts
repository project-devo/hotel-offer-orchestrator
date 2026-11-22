import type Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import type { HotelOffer } from '../../src/domain/types';
import { createHotelStore, hotelKeys, type HotelStore } from '../../src/redis/hotelStore';
import { connectTestRedis } from './testRedis';

const DELHI: HotelOffer[] = [
  { name: 'Courtyard Nine', price: 2500, supplier: 'Supplier B', commissionPct: 7 },
  { name: 'Banyan Stay', price: 2900, supplier: 'Supplier A', commissionPct: 9 },
  { name: 'Neem Tree Inn', price: 3400, supplier: 'Supplier B', commissionPct: 11 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
  { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
  { name: 'Saffron Court', price: 7600, supplier: 'Supplier A', commissionPct: 14 },
  { name: 'Lotus Grand', price: 8200, supplier: 'Supplier A', commissionPct: 12 },
  { name: 'Peacock Plaza', price: 9800, supplier: 'Supplier B', commissionPct: 16 },
  { name: 'Marigold Suites', price: 10950, supplier: 'Supplier B', commissionPct: 11 },
];

let redis: Redis | null;
let store: HotelStore;

beforeAll(async () => {
  redis = await connectTestRedis();
  if (redis) store = createHotelStore(redis, { fullSeconds: 600, partialSeconds: 60 });
});
beforeEach(async () => {
  await redis?.flushdb();
});
afterAll(async () => {
  await redis?.quit();
});

const requireRedis = (ctx: TestContext): Redis => {
  if (!redis) ctx.skip();
  return redis!;
};

describe('hotelStore (Redis)', () => {
  it('writes ZSET, HASH and meta with the full TTL', async (ctx) => {
    const r = requireRedis(ctx);
    await store.saveHotels('delhi', DELHI, []);
    const keys = hotelKeys('delhi');

    expect(await r.zcard(keys.byPrice)).toBe(9);
    expect(await r.zscore(keys.byPrice, 'lotus grand')).toBe('8200');
    expect(JSON.parse((await r.hget(keys.data, 'holtin'))!)).toEqual(DELHI[3]);
    expect(await store.getMeta('delhi')).toMatchObject({ count: 9, failedSuppliers: [] });
    for (const key of Object.values(keys)) {
      const ttl = await r.ttl(key);
      expect(ttl).toBeGreaterThan(60);
      expect(ttl).toBeLessThanOrEqual(600);
    }
  });

  it('uses the short TTL when a supplier failed', async (ctx) => {
    const r = requireRedis(ctx);
    await store.saveHotels('delhi', DELHI.slice(0, 2), ['B']);
    expect(await r.ttl(hotelKeys('delhi').meta)).toBeLessThanOrEqual(60);
    expect(await store.getMeta('delhi')).toMatchObject({ count: 2, failedSuppliers: ['B'] });
  });

  it('filters by price inside Redis with inclusive bounds, ordered by price', async (ctx) => {
    requireRedis(ctx);
    await store.saveHotels('delhi', DELHI, []);
    expect(await store.filterByPrice('delhi')).toEqual(DELHI);
    const names = (rows: HotelOffer[]) => rows.map((h) => h.name);
    expect(names(await store.filterByPrice('delhi', 4000, 7000))).toEqual(['Holtin', 'Radison']);
    expect(names(await store.filterByPrice('delhi', 5340, 5900))).toEqual(['Holtin', 'Radison']);
    expect(names(await store.filterByPrice('delhi', 5341, 5899))).toEqual([]);
  });

  it('supports open-ended bounds', async (ctx) => {
    requireRedis(ctx);
    await store.saveHotels('delhi', DELHI, []);
    expect((await store.filterByPrice('delhi', 9000)).map((h) => h.price)).toEqual([9800, 10950]);
    expect((await store.filterByPrice('delhi', undefined, 3000)).map((h) => h.price)).toEqual([2500, 2900]);
  });

  it('records meta for an empty result so it still counts as a cache hit', async (ctx) => {
    const r = requireRedis(ctx);
    await store.saveHotels('atlantis', [], []);
    expect(await store.getMeta('atlantis')).toMatchObject({ count: 0, failedSuppliers: [] });
    expect(await r.exists(hotelKeys('atlantis').byPrice)).toBe(0);
    expect(await store.filterByPrice('atlantis', 0, 100000)).toEqual([]);
  });

  it('replaces the previous list atomically', async (ctx) => {
    requireRedis(ctx);
    await store.saveHotels('delhi', DELHI, []);
    await store.saveHotels('delhi', DELHI.slice(0, 1), ['A']);
    expect(await store.filterByPrice('delhi')).toEqual(DELHI.slice(0, 1));
  });

  it('returns null meta for an uncached city', async (ctx) => {
    requireRedis(ctx);
    expect(await store.getMeta('nowhere')).toBeNull();
  });
});
