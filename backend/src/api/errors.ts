export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'SUPPLIERS_UNAVAILABLE'
  | 'TEMPORAL_UNAVAILABLE'
  | 'CACHE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** An error that maps directly to an HTTP response `{ error: { code, message, details? } }`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export const cacheUnavailable = (cause: unknown) =>
  new AppError(503, 'CACHE_UNAVAILABLE', 'The cache is temporarily unavailable', undefined, { cause });

/** Run a Redis operation; any failure becomes 503 CACHE_UNAVAILABLE. */
export async function viaRedis<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    throw cacheUnavailable(err);
  }
}
