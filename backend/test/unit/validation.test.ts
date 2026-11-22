import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/api/errors';
import { parseHotelQuery } from '../../src/api/validation';

const fails = (query: Record<string, unknown>) => {
  try {
    parseHotelQuery(query);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
    expect((err as AppError).code).toBe('VALIDATION_ERROR');
    return err as AppError;
  }
  throw new Error(`expected ${JSON.stringify(query)} to be rejected`);
};

describe('parseHotelQuery', () => {
  it('trims and lowercases the city', () => {
    expect(parseHotelQuery({ city: '  DeLhi ' })).toEqual({ city: 'delhi' });
    expect(parseHotelQuery({ city: 'New   Delhi' }).city).toBe('new delhi');
    expect(parseHotelQuery({ city: 'navi-mumbai' }).city).toBe('navi-mumbai');
  });

  it('requires a city', () => {
    expect(fails({}).message).toContain('city is required');
    expect(fails({ city: '   ' }).message).toContain('city is required');
  });

  it('rejects invalid cities', () => {
    fails({ city: 'delhi1' });
    fails({ city: 'del;hi' });
    fails({ city: 'a'.repeat(51) });
    fails({ city: ['delhi', 'mumbai'] });
  });

  it('parses optional price bounds', () => {
    expect(parseHotelQuery({ city: 'delhi', minPrice: '4000', maxPrice: '7000' })).toEqual({
      city: 'delhi',
      minPrice: 4000,
      maxPrice: 7000,
    });
    expect(parseHotelQuery({ city: 'delhi', minPrice: '9000' })).toEqual({ city: 'delhi', minPrice: 9000 });
    expect(parseHotelQuery({ city: 'delhi', maxPrice: '0' })).toEqual({ city: 'delhi', maxPrice: 0 });
    expect(parseHotelQuery({ city: 'delhi', minPrice: '' })).toEqual({ city: 'delhi' });
    expect(parseHotelQuery({ city: 'delhi', minPrice: '5000', maxPrice: '5000' }).minPrice).toBe(5000);
  });

  it('rejects bad price bounds', () => {
    fails({ city: 'delhi', minPrice: '-1' });
    fails({ city: 'delhi', maxPrice: 'abc' });
    fails({ city: 'delhi', minPrice: 'Infinity' });
    const err = fails({ city: 'delhi', minPrice: '8000', maxPrice: '1000' });
    expect(err.message).toContain('minPrice must be less than or equal to maxPrice');
    expect(err.details).toEqual([{ field: 'minPrice', message: 'minPrice must be less than or equal to maxPrice' }]);
  });
});
