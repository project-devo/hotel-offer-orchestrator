import { z } from 'zod';

const int = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);

const boolFlag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(3000, 1),
  APP_MODE: z.enum(['api', 'worker', 'all']).default('all'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_API_KEY: z.string().optional(),
  TEMPORAL_TASK_QUEUE: z.string().default('hotel-offers'),
  EMBEDDED_TEMPORAL: boolFlag,
  SUPPLIER_BASE_URL: z.url().optional(),
  SUPPLIER_TIMEOUT_MS: int(3000, 1),
  SUPPLIER_LATENCY_MS: int(100),
  CACHE_TTL_SECONDS: int(600, 1),
  PARTIAL_CACHE_TTL_SECONDS: int(60, 1),
  SUPPLIER_DOWN_TTL_SECONDS: int(300, 1),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

export type Config = Omit<z.infer<typeof envSchema>, 'SUPPLIER_BASE_URL' | 'CORS_ORIGINS'> & {
  SUPPLIER_BASE_URL: string;
  CORS_ORIGINS: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as unset so `FOO=` in an env file falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const c = parsed.data;
  return {
    ...c,
    SUPPLIER_BASE_URL: (c.SUPPLIER_BASE_URL ?? `http://127.0.0.1:${c.PORT}`).replace(/\/+$/, ''),
    CORS_ORIGINS: c.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

export const config = loadConfig();
