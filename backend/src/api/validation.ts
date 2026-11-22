import { z } from 'zod';
import { AppError } from './errors';

const price = (field: string) =>
  z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce
      .number({ error: `${field} must be a number` })
      .min(0, { error: `${field} must be greater than or equal to 0` })
      .optional(),
  );

export const hotelQuerySchema = z
  .object({
    city: z
      .string({ error: (issue) => (issue.input === undefined ? 'city is required' : 'city must be a single value') })
      .trim()
      .min(1, { error: 'city is required' })
      .max(50, { error: 'city must be at most 50 characters' })
      .regex(/^[a-zA-Z\s-]+$/, { error: 'city may only contain letters, spaces and hyphens' })
      .transform((city) => city.replace(/\s+/g, ' ').toLowerCase()),
    minPrice: price('minPrice'),
    maxPrice: price('maxPrice'),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    error: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

export type HotelQuery = z.infer<typeof hotelQuerySchema>;

export function parseHotelQuery(query: unknown): HotelQuery {
  const parsed = hotelQuerySchema.safeParse(query);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((issue) => ({
    field: issue.path.join('.') || 'query',
    message: issue.message,
  }));
  throw new AppError(400, 'VALIDATION_ERROR', details.map((d) => d.message).join('; '), details);
}
