import type { HotelQuery } from './api.ts';

export interface SearchForm {
  city: string;
  minPrice: string;
  maxPrice: string;
}

export type FieldErrors = Partial<Record<keyof SearchForm, string>>;

// Mirrors the API rules for GET /api/hotels.
export function validateSearch(form: SearchForm): { query?: HotelQuery; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const city = form.city.trim();

  if (!city) errors.city = 'Enter a city.';
  else if (city.length > 50) errors.city = 'City must be 50 characters or fewer.';
  else if (!/^[A-Za-z\s-]+$/.test(city)) errors.city = 'Use letters, spaces and hyphens only.';

  const parsePrice = (raw: string, field: 'minPrice' | 'maxPrice'): number | undefined => {
    const value = raw.trim();
    if (!value) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) errors[field] = 'Enter a number of 0 or more.';
    return n;
  };
  const minPrice = parsePrice(form.minPrice, 'minPrice');
  const maxPrice = parsePrice(form.maxPrice, 'maxPrice');

  if (!errors.minPrice && !errors.maxPrice && minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    errors.maxPrice = 'Max price must be at least the min price.';
  }

  return Object.keys(errors).length ? { errors } : { query: { city, minPrice, maxPrice }, errors };
}
