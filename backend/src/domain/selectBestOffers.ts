import type { HotelOffer, SupplierResult } from './types';

/** Trim and collapse internal whitespace: "  Lotus   Grand " -> "Lotus Grand". */
export const cleanName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/** Key used to decide that two listings are the same hotel. */
export const nameKey = (name: string): string => cleanName(name).toLowerCase();

/**
 * True when `candidate` should replace `current`:
 * lower price wins, then higher commission, then Supplier A.
 */
function beats(candidate: HotelOffer, current: HotelOffer): boolean {
  if (candidate.price !== current.price) return candidate.price < current.price;
  if (candidate.commissionPct !== current.commissionPct) return candidate.commissionPct > current.commissionPct;
  return candidate.supplier < current.supplier; // "Supplier A" < "Supplier B"
}

const compareOffers = (a: HotelOffer, b: HotelOffer): number => {
  if (a.price !== b.price) return a.price - b.price;
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/**
 * De-duplicate hotels across suppliers by normalized name and keep the best offer for each.
 * Pure and deterministic: safe to call from Temporal workflow code.
 */
export function selectBestOffers(results: SupplierResult[]): HotelOffer[] {
  const best = new Map<string, HotelOffer>();

  for (const { supplier, hotels } of results) {
    for (const hotel of hotels) {
      const offer: HotelOffer = {
        name: cleanName(hotel.name),
        price: hotel.price,
        supplier: `Supplier ${supplier}`,
        commissionPct: hotel.commissionPct,
      };
      const key = nameKey(hotel.name);
      const current = best.get(key);
      if (!current || beats(offer, current)) best.set(key, offer);
    }
  }

  return [...best.values()].sort(compareOffers);
}
