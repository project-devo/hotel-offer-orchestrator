import { describe, expect, it } from 'vitest';
import { nameKey, selectBestOffers } from '../../src/domain/selectBestOffers';
import type { SupplierHotel, SupplierId } from '../../src/domain/types';
import supplierA from '../../src/data/supplierA.json';
import supplierB from '../../src/data/supplierB.json';

let seq = 0;
const hotel = (name: string, price: number, commissionPct: number): SupplierHotel => ({
  hotelId: `h${++seq}`,
  name,
  price,
  city: 'testville',
  commissionPct,
});

const run = (a: SupplierHotel[], b: SupplierHotel[]) =>
  selectBestOffers([
    { supplier: 'A', hotels: a },
    { supplier: 'B', hotels: b },
  ]);

const forCity = (rows: SupplierHotel[], city: string) => rows.filter((h) => h.city === city);

describe('selectBestOffers', () => {
  it('picks Supplier B when B is cheaper', () => {
    expect(run([hotel('Holtin', 6000, 10)], [hotel('Holtin', 5340, 20)])).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
    ]);
  });

  it('picks Supplier A when A is cheaper', () => {
    expect(run([hotel('Radison', 5900, 13)], [hotel('Radison', 6150, 18)])).toEqual([
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
    ]);
  });

  it('passes through hotels that only one supplier returns', () => {
    const result = run([hotel('Only A', 3000, 5)], [hotel('Only B', 4000, 6)]);
    expect(result).toEqual([
      { name: 'Only A', price: 3000, supplier: 'Supplier A', commissionPct: 5 },
      { name: 'Only B', price: 4000, supplier: 'Supplier B', commissionPct: 6 },
    ]);
  });

  it('breaks a price tie with the higher commission', () => {
    expect(run([hotel('Neem', 3400, 8)], [hotel('Neem', 3400, 11)])[0]).toMatchObject({
      supplier: 'Supplier B',
      commissionPct: 11,
    });
    expect(run([hotel('Neem', 3400, 12)], [hotel('Neem', 3400, 11)])[0]).toMatchObject({
      supplier: 'Supplier A',
      commissionPct: 12,
    });
  });

  it('prefers Supplier A on a full tie, regardless of input order', () => {
    const a = { supplier: 'A' as SupplierId, hotels: [hotel('Tie', 5000, 10)] };
    const b = { supplier: 'B' as SupplierId, hotels: [hotel('Tie', 5000, 10)] };
    expect(selectBestOffers([a, b])[0]?.supplier).toBe('Supplier A');
    expect(selectBestOffers([b, a])[0]?.supplier).toBe('Supplier A');
  });

  it('matches names case-insensitively, ignoring surrounding and repeated whitespace', () => {
    const result = run([hotel('Lotus Grand', 8200, 12)], [hotel('  lotus   GRAND ', 8100, 15)]);
    expect(result).toHaveLength(1);
    // The winner's own name is used, trimmed and with whitespace collapsed.
    expect(result[0]).toEqual({ name: 'lotus GRAND', price: 8100, supplier: 'Supplier B', commissionPct: 15 });
  });

  it('normalizes the key used for matching', () => {
    expect(nameKey('  Lotus   Grand ')).toBe('lotus grand');
  });

  it('handles empty inputs', () => {
    expect(selectBestOffers([])).toEqual([]);
    expect(run([], [])).toEqual([]);
    expect(run([hotel('X', 100, 5)], [])).toHaveLength(1);
  });

  it('sorts by price ascending, then by name', () => {
    const result = run([hotel('Zeta', 3000, 5), hotel('Beta', 1000, 5)], [hotel('Alpha', 3000, 5)]);
    expect(result.map((h) => h.name)).toEqual(['Beta', 'Alpha', 'Zeta']);
  });

  it('returns exactly four keys per item', () => {
    for (const item of run([hotel('A', 1, 1)], [hotel('B', 2, 2)])) {
      expect(Object.keys(item).sort()).toEqual(['commissionPct', 'name', 'price', 'supplier']);
    }
  });

  it('produces the exact expected Delhi result from the mock data', () => {
    const result = run(forCity(supplierA, 'delhi'), forCity(supplierB, 'delhi'));
    expect(result).toEqual([
      { name: 'Courtyard Nine', price: 2500, supplier: 'Supplier B', commissionPct: 7 },
      { name: 'Banyan Stay', price: 2900, supplier: 'Supplier A', commissionPct: 9 },
      { name: 'Neem Tree Inn', price: 3400, supplier: 'Supplier B', commissionPct: 11 },
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
      { name: 'Saffron Court', price: 7600, supplier: 'Supplier A', commissionPct: 14 },
      { name: 'Lotus Grand', price: 8200, supplier: 'Supplier A', commissionPct: 12 },
      { name: 'Peacock Plaza', price: 9800, supplier: 'Supplier B', commissionPct: 16 },
      { name: 'Marigold Suites', price: 10950, supplier: 'Supplier B', commissionPct: 11 },
    ]);
  });
});
