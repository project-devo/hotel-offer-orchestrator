export type SupplierId = 'A' | 'B';
export type SupplierName = `Supplier ${SupplierId}`;

export const SUPPLIER_IDS: readonly SupplierId[] = ['A', 'B'];

/** Raw hotel record as returned by a mock supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** One supplier's response, tagged with which supplier produced it. */
export interface SupplierResult {
  supplier: SupplierId;
  hotels: SupplierHotel[];
}

/** Item of the public `/api/hotels` response. Exactly these four keys. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

export interface HotelOffersInput {
  city: string;
}

export interface HotelOffersResult {
  city: string;
  hotels: HotelOffer[];
  failedSuppliers: SupplierId[];
  fetchedAt: string;
}
