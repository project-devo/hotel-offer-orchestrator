import fs from 'node:fs';
import path from 'node:path';
import { DefaultLogger, NativeConnection, Runtime, Worker, type LogLevel } from '@temporalio/worker';
import { config } from '../config';
import { logger } from '../logger';
import type { Activities } from './activities';
import { temporalConnectionOptions } from './connection';

/** Written by `npm run build:workflows`. Present in production images, absent in dev/tests. */
const WORKFLOW_BUNDLE_PATH = path.resolve(__dirname, '../workflow-bundle.js');

const temporalLevel: Record<string, LogLevel> = { trace: 'TRACE', debug: 'DEBUG', info: 'INFO', warn: 'WARN' };

let runtimeInstalled = false;

/** Route SDK, workflow and activity logs through pino so everything is structured JSON. */
function installRuntimeLogger(): void {
  if (runtimeInstalled) return;
  runtimeInstalled = true;
  const log = logger.child({ component: 'temporal' });
  const methods = { TRACE: 'trace', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' } as const;
  Runtime.install({
    logger: new DefaultLogger(temporalLevel[config.LOG_LEVEL] ?? 'ERROR', ({ level, message, meta }) => {
      log[methods[level]](meta ?? {}, message);
    }),
  });
}

function workflowSource() {
  if (fs.existsSync(WORKFLOW_BUNDLE_PATH)) {
    return { workflowBundle: { codePath: WORKFLOW_BUNDLE_PATH } };
  }
  return { workflowsPath: require.resolve('./workflows') };
}

export interface RunningWorker {
  /** Settles when the worker stops; rejects if it crashes. */
  done: Promise<void>;
  shutdown(): Promise<void>;
}

export async function startWorker(activities: Activities): Promise<RunningWorker> {
  installRuntimeLogger();
  const connection = await NativeConnection.connect(temporalConnectionOptions(config));
  const source = workflowSource();
  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    activities,
    maxCachedWorkflows: 50,
    maxConcurrentActivityTaskExecutions: 20,
    ...source,
  });
  logger.info(
    { taskQueue: config.TEMPORAL_TASK_QUEUE, prebuiltBundle: 'workflowBundle' in source },
    'Temporal worker started',
  );

  const done = worker.run().finally(() => connection.close());
  return {
    done,
    async shutdown() {
      if (worker.getState() === 'RUNNING') worker.shutdown();
      await done;
    },
  };
}
