import type { Config } from '../config';

export interface TemporalConnectionOptions {
  address: string;
  tls?: boolean;
  apiKey?: string;
}

/**
 * Same options work for the client `Connection` and the worker `NativeConnection`.
 * Local dev server / compose: plain address. Temporal Cloud: TLS + API key.
 */
export function temporalConnectionOptions(
  config: Pick<Config, 'TEMPORAL_ADDRESS' | 'TEMPORAL_API_KEY'>,
): TemporalConnectionOptions {
  if (config.TEMPORAL_API_KEY) {
    return { address: config.TEMPORAL_ADDRESS, tls: true, apiKey: config.TEMPORAL_API_KEY };
  }
  return { address: config.TEMPORAL_ADDRESS };
}
