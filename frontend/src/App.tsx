import { useEffect, useRef, useState } from 'react';
import { Results, type ResultsState } from './components/Results.tsx';
import { SearchCard } from './components/SearchCard.tsx';
import { StatusPanel } from './components/StatusPanel.tsx';
import {
  API_URL,
  getHealth,
  getHotels,
  getSupplierStatus,
  type ApiError,
  type Health,
  type HotelQuery,
  type SupplierId,
  type SupplierStatus,
} from './lib/api.ts';

const HEALTH_POLL_MS = 15_000;
const COLD_START_MS = 3_000;

export default function App() {
  const [results, setResults] = useState<ResultsState>({ kind: 'idle' });
  const [serverError, setServerError] = useState<string | null>(null);
  const lastQuery = useRef<HotelQuery | null>(null);
  const searchSeq = useRef(0);

  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<ApiError | null>(null);
  const [suppliers, setSuppliers] = useState<Record<SupplierId, SupplierStatus> | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [backendAnswered, setBackendAnswered] = useState(false);
  const [slowStart, setSlowStart] = useState(false);

  async function search(query: HotelQuery) {
    const seq = ++searchSeq.current;
    lastQuery.current = query;
    setServerError(null);
    setResults({ kind: 'loading' });
    try {
      const data = await getHotels(query);
      if (seq === searchSeq.current) setResults({ kind: 'success', query, data });
    } catch (e) {
      if (seq !== searchSeq.current) return;
      const error = e as ApiError;
      if (error.status === 400) {
        setServerError(error.message);
        setResults({ kind: 'idle' });
      } else {
        setResults({ kind: 'error', error });
      }
    }
  }

  function reset() {
    searchSeq.current++; // drop any in-flight search
    lastQuery.current = null;
    setServerError(null);
    setResults({ kind: 'idle' });
  }

  async function refreshStatus() {
    const suppliersDone = getSupplierStatus().then(setSuppliers, () => setSuppliers(null));
    const [h] = await Promise.allSettled([getHealth(), suppliersDone]);
    if (h.status === 'fulfilled') {
      setHealth(h.value);
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(h.reason as ApiError);
    }
    setCheckedAt(new Date());
    // Any HTTP response (even an error) means the server is awake.
    if (h.status === 'fulfilled' || (h.reason as ApiError).status > 0) setBackendAnswered(true);
  }

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      await refreshStatus();
      if (!stopped) timer = window.setTimeout(poll, HEALTH_POLL_MS);
    };
    poll();
    const slow = window.setTimeout(() => setSlowStart(true), COLD_START_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(slow);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <div role="status">
        {slowStart && !backendAnswered && (
          <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-2.5 text-center text-sm font-medium text-amber-950">
            <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-amber-700 border-t-transparent" />
            Waking up the free backend server — this can take up to a minute
          </div>
        )}
      </div>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-5 sm:px-6">
          <svg aria-hidden="true" viewBox="0 0 32 32" className="size-9 shrink-0">
            <rect width="32" height="32" rx="7" fill="#4f46e5" />
            <path d="M10 9v14M22 9v14M10 16h12" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
          </svg>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Hotel Offer Orchestrator</h1>
            <p className="text-sm text-slate-600">
              Two suppliers → Temporal workflow → best price per hotel, cached in Redis.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <SearchCard loading={results.kind === 'loading'} serverError={serverError} onSearch={search} onReset={reset} />
          <Results state={results} onRetry={() => lastQuery.current && search(lastQuery.current)} />
        </div>
        <StatusPanel
          health={health}
          healthError={healthError}
          suppliers={suppliers}
          checkedAt={checkedAt}
          onRefresh={refreshStatus}
        />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 sm:px-6">
        API: <code className="font-mono">{API_URL}</code>
      </footer>
    </div>
  );
}
