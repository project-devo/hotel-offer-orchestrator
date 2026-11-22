import { randomUUID } from 'node:crypto';
import {
  ActivityFailure,
  ApplicationFailure,
  Client,
  Connection,
  ServiceError,
  TimeoutFailure,
  WorkflowFailedError,
  isGrpcServiceError,
} from '@temporalio/client';
import { AppError, cacheUnavailable } from '../api/errors';
import { config } from '../config';
import type { HotelOffersResult } from '../domain/types';
import { temporalConnectionOptions } from './connection';
import type { hotelOffersWorkflow } from './workflows';

export interface WorkflowRun {
  workflowId: string;
  result: HotelOffersResult;
}

export type WorkflowRunner = (city: string) => Promise<WorkflowRun>;

let clientPromise: Promise<Client> | undefined;

/** Lazily-created singleton. A failed connect is forgotten so the next call retries. */
export function getTemporalClient(): Promise<Client> {
  clientPromise ??= Connection.connect({ ...temporalConnectionOptions(config), connectTimeout: '5s' })
    .then((connection) => new Client({ connection, namespace: config.TEMPORAL_NAMESPACE }))
    .catch((err: unknown) => {
      clientPromise = undefined;
      throw err;
    });
  return clientPromise;
}

export async function closeTemporalClient(): Promise<void> {
  const pending = clientPromise;
  clientPromise = undefined;
  const client = await pending?.catch(() => undefined);
  await client?.connection.close();
}

/** Used by /health: succeeds only if the Temporal frontend answers an RPC. */
export async function checkTemporal(): Promise<void> {
  const client = await getTemporalClient();
  await client.connection.workflowService.getSystemInfo({});
}

/** Map Temporal errors to the API's error contract; unknown errors pass through (500). */
export function toAppError(err: unknown): unknown {
  if (err instanceof WorkflowFailedError) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure && cause.type === 'AllSuppliersUnavailable') {
      return new AppError(503, 'SUPPLIERS_UNAVAILABLE', 'All suppliers are currently unavailable', undefined, { cause: err });
    }
    if (cause instanceof ActivityFailure && cause.activityType === 'saveHotelsToCache') {
      return cacheUnavailable(err);
    }
    if (cause instanceof TimeoutFailure) {
      return new AppError(503, 'TEMPORAL_UNAVAILABLE', 'The workflow did not complete in time', undefined, { cause: err });
    }
    return err;
  }
  if (err instanceof ServiceError || isGrpcServiceError(err)) {
    return new AppError(503, 'TEMPORAL_UNAVAILABLE', 'The workflow engine is temporarily unavailable', undefined, { cause: err });
  }
  return err;
}

export const runHotelOffersWorkflow: WorkflowRunner = async (city) => {
  const workflowId = `hotel-offers-${city.replace(/\s+/g, '-')}-${randomUUID()}`;
  try {
    const client = await getTemporalClient();
    const result = await client.workflow.execute<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [{ city }],
      workflowExecutionTimeout: '30s',
    });
    return { workflowId, result };
  } catch (err) {
    throw toAppError(err);
  }
};
