import { useState, type FormEvent } from 'react';
import type { HotelQuery } from '../lib/api.ts';
import { validateSearch, type FieldErrors, type SearchForm } from '../lib/validate.ts';

const EMPTY: SearchForm = { city: '', minPrice: '', maxPrice: '' };

const CHIPS = [
  { city: 'Delhi' },
  { city: 'Mumbai' },
  { city: 'Bangalore' },
  { city: 'Atlantis', note: 'no-results demo' },
];

interface Props {
  loading: boolean;
  serverError: string | null;
  onSearch: (query: HotelQuery) => void;
  onReset: () => void;
}

export function SearchCard({ loading, serverError, onSearch, onReset }: Props) {
  const [form, setForm] = useState<SearchForm>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(next: SearchForm) {
    const { query, errors } = validateSearch(next);
    setErrors(errors);
    if (query) onSearch(query);
    else document.getElementById((['city', 'minPrice', 'maxPrice'] as const).find((k) => errors[k])!)?.focus();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(form);
  }

  function pickCity(city: string) {
    const next = { ...form, city };
    setForm(next);
    submit(next);
  }

  function reset() {
    setForm(EMPTY);
    setErrors({});
    onReset();
  }

  const field = (name: keyof SearchForm) => ({
    id: name,
    name,
    value: form[name],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [name]: e.target.value })),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    className: `mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 ${
      errors[name] ? 'border-red-500' : 'border-slate-300'
    }`,
  });

  const fieldError = (name: keyof SearchForm) =>
    errors[name] && (
      <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
        {errors[name]}
      </p>
    );

  return (
    <section aria-labelledby="search-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="search-heading" className="text-lg font-semibold">
        Search hotels
      </h2>

      <form noValidate onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="city" className="block text-sm font-medium text-slate-700">
            City
          </label>
          <input {...field('city')} type="text" autoComplete="off" maxLength={50} placeholder="e.g. Delhi" />
          {fieldError('city')}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Try:</span>
            {CHIPS.map(({ city, note }) => (
              <button
                key={city}
                type="button"
                onClick={() => pickCity(city)}
                className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
              >
                {city}
                {note && <span className="ml-1 text-xs text-slate-500">({note})</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="minPrice" className="block text-sm font-medium text-slate-700">
              Min price (₹) <span className="font-normal text-slate-500">optional</span>
            </label>
            <input {...field('minPrice')} type="text" inputMode="decimal" placeholder="0" />
            {fieldError('minPrice')}
          </div>
          <div>
            <label htmlFor="maxPrice" className="block text-sm font-medium text-slate-700">
              Max price (₹) <span className="font-normal text-slate-500">optional</span>
            </label>
            <input {...field('maxPrice')} type="text" inputMode="decimal" placeholder="10000" />
            {fieldError('maxPrice')}
          </div>
        </div>

        {serverError && Object.keys(errors).length === 0 && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </form>
    </section>
  );
}
