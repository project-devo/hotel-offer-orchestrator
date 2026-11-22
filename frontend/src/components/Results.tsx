import { useState } from 'react';
import type { ApiError, HotelQuery, HotelsResult, SupplierName } from '../lib/api.ts';

export type ResultsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; query: HotelQuery; data: HotelsResult }
  | { kind: 'error'; error: ApiError };

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function Results({ state, onRetry }: { state: ResultsState; onRetry: () => void }) {
  return (
    <section
      aria-labelledby="results-heading"
      aria-busy={state.kind === 'loading'}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="results-heading" className="text-lg font-semibold">
        Best offers
      </h2>
      <div aria-live="polite" className="mt-4">
        {state.kind === 'idle' && (
          <p className="text-sm text-slate-600">Search for a city to compare offers from both suppliers.</p>
        )}
        {state.kind === 'loading' && (
          <>
            <p className="sr-only">Searching for hotels…</p>
            <Skeleton />
          </>
        )}
        {state.kind === 'error' && <ErrorState error={state.error} onRetry={onRetry} />}
        {state.kind === 'success' && <ResultList query={state.query} data={state.data} />}
      </div>
    </section>
  );
}

function ResultList({ query, data }: { query: HotelQuery; data: HotelsResult }) {
  const { hotels, cache, workflowId, failedSuppliers } = data;
  const filtered = query.minPrice !== undefined || query.maxPrice !== undefined;

  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
        <span>
          <strong className="font-semibold text-slate-900">{hotels.length}</strong>{' '}
          {hotels.length === 1 ? 'hotel' : 'hotels'} in <span className="capitalize">{query.city}</span>
        </span>
        {cache && (
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
              cache === 'HIT' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
            }`}
          >
            Cache {cache}
          </span>
        )}
        {workflowId && <WorkflowId id={workflowId} />}
      </p>

      {failedSuppliers.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Partial results.</strong>{' '}
          {failedSuppliers.map((s) => `Supplier ${s}`).join(' and ')} did not respond, so these offers come from the
          remaining supplier only.
        </div>
      )}

      {hotels.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
          <p className="font-medium text-slate-900">No hotels found</p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Nothing matches this price range. Try widening it.'
              : 'Neither supplier has offers for this city. Try Delhi, Mumbai or Bangalore.'}
          </p>
        </div>
      ) : (
        <>
          <table className="mt-4 hidden w-full text-left text-sm md:table">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Hotel</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Price</th>
                <th scope="col" className="py-2 pr-4 font-medium">Supplier</th>
                <th scope="col" className="py-2 text-right font-medium">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hotels.map((h) => (
                <tr key={h.name}>
                  <th scope="row" className="py-3 pr-4 font-medium text-slate-900">{h.name}</th>
                  <td className="py-3 pr-4 text-right font-semibold tabular-nums">{inr.format(h.price)}</td>
                  <td className="py-3 pr-4"><SupplierBadge supplier={h.supplier} /></td>
                  <td className="py-3 text-right tabular-nums text-slate-700">{h.commissionPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="mt-4 space-y-3 md:hidden">
            {hotels.map((h) => (
              <li key={h.name} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-900">{h.name}</p>
                  <p className="font-semibold tabular-nums">{inr.format(h.price)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                  <SupplierBadge supplier={h.supplier} />
                  <span>Commission {h.commissionPct}%</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function SupplierBadge({ supplier }: { supplier: SupplierName }) {
  const style = supplier === 'Supplier A' ? 'bg-sky-100 text-sky-800 ring-sky-200' : 'bg-violet-100 text-violet-800 ring-violet-200';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${style}`}>{supplier}</span>;
}

function WorkflowId({ id }: { id: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const short = id.length > 24 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id;

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Workflow</span>
      <code title={id} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
        {short}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy workflow id"
        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4">
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        </svg>
      </button>
      <span role="status" className="text-xs text-slate-500">
        {copied === true ? 'Copied' : copied === false ? 'Copy failed' : ''}
      </span>
    </span>
  );
}

const ERROR_COPY: Record<string, { title: string; hint: string }> = {
  SUPPLIERS_UNAVAILABLE: {
    title: 'Suppliers unavailable',
    hint: 'Neither supplier responded, so there are no offers to compare. Bring a supplier back online in the outage simulator or try again shortly.',
  },
  TEMPORAL_UNAVAILABLE: {
    title: 'Workflow engine unavailable',
    hint: 'The Temporal server is not reachable right now, so the comparison workflow could not run. Try again in a moment.',
  },
  CACHE_UNAVAILABLE: {
    title: 'Cache unavailable',
    hint: 'Redis is not reachable right now, so results could not be stored or filtered. Try again in a moment.',
  },
  NETWORK_ERROR: {
    title: 'Backend unreachable',
    hint: 'The request never got a response. The server may be starting up or offline.',
  },
};

function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const copy = ERROR_COPY[error.code] ??
    (error.status === 503 ? ERROR_COPY.SUPPLIERS_UNAVAILABLE : { title: 'Something went wrong', hint: 'The server could not complete the search.' });

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1">{copy.hint}</p>
      <p className="mt-1 text-red-800/80">
        {error.message} {error.status > 0 && <span className="font-mono text-xs">({error.status} {error.code})</span>}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden="true">
      <div className="h-4 w-48 rounded bg-slate-200" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-slate-100 p-3">
          <div className="h-4 flex-1 rounded bg-slate-200" />
          <div className="h-4 w-20 rounded bg-slate-200" />
          <div className="hidden h-5 w-24 rounded-full bg-slate-200 sm:block" />
        </div>
      ))}
    </div>
  );
}
