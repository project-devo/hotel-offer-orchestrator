import { z } from 'zod';

// Kept out of types.ts so workflow code (which imports types) doesn't bundle zod.
export const supplierHotelSchema = z.object({
  hotelId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().finite().nonnegative(),
  city: z.string().min(1),
  commissionPct: z.number().finite().min(0).max(100),
});

export const supplierHotelsSchema = z.array(supplierHotelSchema);
