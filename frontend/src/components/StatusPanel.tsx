import { useState } from 'react';
import {
  ApiError,
  setSupplierDown,
  setSupplierUp,
  type Health,
  type SupplierId,
  type SupplierStatus,
} from '../lib/api.ts';

interface Props {
  health: Health | null;
  healthError: ApiError | null;
  suppliers: Record<SupplierId, SupplierStatus> | null;
  checkedAt: Date | null;
  onRefresh: () => Promise<void>;
}

const OVERALL = {
  ok: { label: 'Operational', style: 'bg-emerald-100 text-emerald-800' },
  degraded: { label: 'Degraded', style: 'bg-amber-100 text-amber-900' },
  down: { label: 'Down', style: 'bg-red-100 text-red-800' },
};

export function StatusPanel({ health, healthError, suppliers, checkedAt, onRefresh }: Props) {
  const [pending, setPending] = useState<SupplierId | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggle(id: SupplierId, goDown: boolean) {
    setPending(id);
    setToggleError(null);
    try {
      await (goDown ? setSupplierDown(id) : setSupplierUp(id));
    } catch (e) {
      setToggleError(e instanceof ApiError ? e.message : 'Could not change the supplier status.');
    }
    await onRefresh();
    setPending(null);
  }

  const overall = health
    ? OVERALL[health.status]
    : healthError
      ? { label: 'Unreachable', style: 'bg-slate-200 text-slate-800' }
      : { label: 'Checking…', style: 'bg-slate-100 text-slate-600' };

  const rows = health
    ? [
        { name: 'Supplier A', ...health.suppliers.supplierA },
        { name: 'Supplier B', ...health.suppliers.supplierB },
        { name: 'Redis', ...health.dependencies.redis },
        { name: 'Temporal', ...health.dependencies.temporal },
      ]
    : [];

  return (
    <aside aria-labelledby="status-heading" className="space-y-6 lg:sticky lg:top-6 lg:self-start">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 id="status-heading" className="text-lg font-semibold">
            System status
          </h2>
          <span role="status" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${overall.style}`}>
            {overall.label}
          </span>
        </div>

        {healthError && (
          <p className="mt-3 text-sm text-slate-600">
            Health check failed: {healthError.message} Retrying every 15 s.
          </p>
        )}

        {rows.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.name} className="py-2.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    <span
                      aria-hidden="true"
                      className={`size-2.5 rounded-full ${row.status === 'up' ? 'bg-emerald-500' : 'bg-red-500'}`}
                    />
                    {row.name}
                  </span>
                  <span className={row.status === 'up' ? 'text-slate-700' : 'font-semibold text-red-700'}>
                    {row.status === 'up' ? 'Up' : 'Down'}
                    {'latencyMs' in row && <span className="text-slate-500 tabular-nums"> · {row.latencyMs} ms</span>}
                  </span>
                </div>
                {row.error && <p className="mt-0.5 pl-4.5 text-xs text-slate-500">{row.error}</p>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : 'Checking…'}</span>
          <button type="button" onClick={onRefresh} className="rounded px-1.5 py-0.5 font-medium text-indigo-700 hover:bg-indigo-50">
            Check now
          </button>
        </div>
      </section>

      <section aria-labelledby="sim-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 id="sim-heading" className="text-lg font-semibold">
          Outage simulator
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Take a supplier offline to see partial results and degraded health. Each outage auto-recovers after 5 minutes.
        </p>

        <ul className="mt-4 space-y-3">
          {(['A', 'B'] as const).map((id) => {
            const status = suppliers?.[id];
            const up = status?.status === 'up';
            return (
              <li key={id} className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <p className="font-medium text-slate-800">Supplier {id}</p>
                  <p className="text-xs text-slate-500">
                    {!status
                      ? 'Status unknown'
                      : up
                        ? 'Online'
                        : `Offline${status.ttlSeconds ? ` · recovers in ~${Math.ceil(status.ttlSeconds / 60)} min` : ''}`}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={up}
                  aria-label={`Supplier ${id} online`}
                  disabled={!status || pending !== null}
                  onClick={() => toggle(id, up)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    up ? 'bg-emerald-600' : 'bg-slate-400'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                      up ? 'translate-x-5.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>

        <p aria-live="polite" className="mt-3 text-sm text-red-700">
          {toggleError}
        </p>
      </section>
    </aside>
  );
}
