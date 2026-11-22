import { describe, expect, it } from 'vitest';
import { nameKey, selectBestOffers } from '../../src/domain/selectBestOffers';
import { supplierHotelsSchema } from '../../src/domain/schemas';
import type { SupplierHotel } from '../../src/domain/types';
import supplierA from '../../src/data/supplierA.json';
import supplierB from '../../src/data/supplierB.json';

const cities = ['delhi', 'mumbai', 'bangalore'];
const inCity = (rows: SupplierHotel[], city: string) => rows.filter((h) => h.city === city);
const overlap = (city: string) => {
  const bKeys = new Set(inCity(supplierB, city).map((h) => nameKey(h.name)));
  return inCity(supplierA, city).filter((h) => bKeys.has(nameKey(h.name)));
};

describe('mock supplier data', () => {
  it.each([
    ['A', supplierA],
    ['B', supplierB],
  ])('supplier %s matches the supplier schema and business ranges', (_, rows) => {
    expect(supplierHotelsSchema.safeParse(rows).success).toBe(true);
    for (const h of rows) {
      expect(h.price).toBeGreaterThanOrEqual(2000);
      expect(h.price).toBeLessThanOrEqual(15000);
      expect(h.commissionPct).toBeGreaterThanOrEqual(5);
      expect(h.commissionPct).toBeLessThanOrEqual(25);
      expect(h.city).toBe(h.city.toLowerCase());
    }
  });

  it('uses unique, correctly prefixed hotel ids', () => {
    const ids = [...supplierA, ...supplierB].map((h) => h.hotelId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(supplierA.every((h) => /^a\d+$/.test(h.hotelId))).toBe(true);
    expect(supplierB.every((h) => /^b\d+$/.test(h.hotelId))).toBe(true);
  });

  it.each(cities)('has at least 5 hotels per supplier in %s', (city) => {
    expect(inCity(supplierA, city).length).toBeGreaterThanOrEqual(5);
    expect(inCity(supplierB, city).length).toBeGreaterThanOrEqual(5);
  });

  it('has the required overlaps per city', () => {
    expect(overlap('delhi').length).toBeGreaterThanOrEqual(5);
    expect(overlap('mumbai').length).toBeGreaterThanOrEqual(3);
    expect(overlap('bangalore').length).toBeGreaterThanOrEqual(2);
  });

  it('has a Mumbai overlap won by each supplier', () => {
    const overlapping = new Set(overlap('mumbai').map((h) => nameKey(h.name)));
    const winners = selectBestOffers([
      { supplier: 'A', hotels: inCity(supplierA, 'mumbai') },
      { supplier: 'B', hotels: inCity(supplierB, 'mumbai') },
    ])
      .filter((h) => overlapping.has(nameKey(h.name)))
      .map((h) => h.supplier);
    expect(winners).toContain('Supplier A');
    expect(winners).toContain('Supplier B');
  });

  it('keeps the deliberately messy Delhi name in Supplier B', () => {
    expect(supplierB.find((h) => h.hotelId === 'b3')?.name).toBe('lotus grand ');
  });
});
