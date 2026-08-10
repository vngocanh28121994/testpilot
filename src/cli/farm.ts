import { loadConfig } from '../config.js';
import { scheduleFarmRun } from '../farm/devicefarm.js';
import { farmSecretEnv } from '../core/secrets.js';

/**
 * Ships the native suite to AWS Device Farm and waits for the verdict.
 * Expects `npm run build` and the bundle step to have produced the zip first.
 */
async function main(): Promise<void> {
  const cfg = await loadConfig();

  const log = (line: string) => console.log(`[farm] ${line}`);

  console.log(`[farm] uploading ${cfg.farm.platform} build + test package…`);
  const run = await scheduleFarmRun(
    {
      ...cfg.farm,
      env: { ...cfg.farm.env, ...(await farmSecretEnv(cfg, log)) },
      runsDir: cfg.paths.runs,
      flakeDb: cfg.paths.flakeDb,
      reportsDir: cfg.paths.reports,
      retention: cfg.retention,
    },
    { log },
  );

  console.log(`[farm] ${run.runArn}`);
  console.log(`[farm] status=${run.status} result=${run.result}`);
  console.log(`[farm] counters ${JSON.stringify(run.counters)}`);
  for (const a of run.artifacts.slice(0, 40)) {
    console.log(`[farm] ${a.type.padEnd(20)} ${a.name} ${a.url}`);
  }

  if (run.result !== 'PASSED') process.exit(1);
}

main().catch((err: Error) => {
  console.error(`[farm] ${err.message}`);
  process.exit(1);
});
