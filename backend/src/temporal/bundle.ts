/**
 * Build-time step (`npm run build:workflows`): pre-bundle workflow code so the worker
 * never runs webpack at startup — too heavy for a 512 MB / 0.1 CPU instance.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleWorkflowCode } from '@temporalio/worker';

async function main(): Promise<void> {
  const { code } = await bundleWorkflowCode({ workflowsPath: require.resolve('./workflows') });
  const outPath = path.resolve(__dirname, '../workflow-bundle.js');
  await writeFile(outPath, code);
  console.log(`Workflow bundle written to ${outPath} (${Math.round(code.length / 1024)} KiB)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
