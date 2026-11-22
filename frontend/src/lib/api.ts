export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

export type SupplierName = 'Supplier A' | 'Supplier B';
export type SupplierId = 'A' | 'B';
type UpDown = 'up' | 'down';

export interface Hotel {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

export interface HotelQuery {
  city: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface HotelsResult {
  hotels: Hotel[];
  cache: 'HIT' | 'MISS' | null;
  workflowId: string | null;
  failedSuppliers: string[];
  requestId: string | null;
}

export interface SupplierHealth {
  status: UpDown;
  latencyMs: number;
  error?: string;
}

export interface DependencyHealth {
  status: UpDown;
  error?: string;
}

export interface Health {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  suppliers: { supplierA: SupplierHealth; supplierB: SupplierHealth };
  dependencies: { redis: DependencyHealth; temporal: DependencyHealth };
}

export interface SupplierStatus {
  status: UpDown;
  ttlSeconds: number | null;
}

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function send(path: string, init?: RequestInit): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Could not reach the backend at ${API_URL}.`);
  }
  const body: unknown = await res.json().catch(() => null);
  return { res, body };
}

function toError(res: Response, body: unknown): ApiError {
  const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  return new ApiError(
    res.status,
    err?.code ?? 'HTTP_ERROR',
    err?.message ?? `Request failed with HTTP ${res.status}.`,
    err?.details,
  );
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const { res, body } = await send(path, init);
  if (!res.ok || body === null) throw toError(res, body);
  return body as T;
}

export async function getHotels(query: HotelQuery): Promise<HotelsResult> {
  const params = new URLSearchParams({ city: query.city });
  if (query.minPrice !== undefined) params.set('minPrice', String(query.minPrice));
  if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));

  const { res, body } = await send(`/api/hotels?${params}`);
  if (!res.ok || !Array.isArray(body)) throw toError(res, body);

  const headers = res.headers;
  return {
    hotels: body as Hotel[],
    cache: headers.get('X-Cache') as HotelsResult['cache'],
    workflowId: headers.get('X-Workflow-Id'),
    failedSuppliers: (headers.get('X-Failed-Suppliers') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    requestId: headers.get('X-Request-Id'),
  };
}

/** Resolves with the health body on 200 and on 503 (status "down"). */
export async function getHealth(): Promise<Health> {
  const { res, body } = await send('/health');
  if ((res.ok || res.status === 503) && (body as Health | null)?.suppliers) return body as Health;
  throw toError(res, body);
}

export async function getSupplierStatus(): Promise<Record<SupplierId, SupplierStatus>> {
  return (await json<{ suppliers: Record<SupplierId, SupplierStatus> }>('/admin/suppliers')).suppliers;
}

export const setSupplierDown = (id: SupplierId) =>
  json<{ supplier: SupplierId; status: 'down'; autoRecoverSeconds: number }>(`/admin/suppliers/${id}/down`, {
    method: 'POST',
  });

export const setSupplierUp = (id: SupplierId) =>
  json<{ supplier: SupplierId; status: 'up' }>(`/admin/suppliers/${id}/up`, { method: 'POST' });
