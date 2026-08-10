import { loadConfig } from '../config.js';
import { collectFarmRun, listRuns as listFarmRuns } from '../farm/devicefarm.js';

/**
 * Re-attaches to a Device Farm run that is already scheduled.
 *
 *   npm run farm:pull                 # newest run in the project
 *   npm run farm:pull -- --arn <arn>
 *
 * `npm run farm` schedules a run and then polls it, but those two things fail
 * for different reasons: the run executes on AWS, while the polling happens on
 * a laptop whose credentials expire mid-wait, whose network drops, and whose
 * terminal gets closed. Losing the poller used to mean losing the report, the
 * videos and the verdicts — the run itself had finished fine, but nothing ever
 * fetched it and the presigned URLs went stale.
 *
 * Device minutes are already spent by the time this matters, so recovering a
 * run has to be cheaper than repeating one.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--arn');
  const cfg = await loadConfig(argv.includes('--config') ? argv[argv.indexOf('--config') + 1]! : 'testpilot.config.json');

  let arn = at >= 0 ? argv[at + 1] : undefined;
  if (!arn) {
    const runs = await listFarmRuns(cfg.farm.region, cfg.farm.projectArn);
    const newest = runs[0];
    if (!newest) throw new Error('Project chưa có run nào để lấy về.');
    arn = newest.arn;
    console.log(`[farm] run mới nhất: ${newest.name} (${newest.status}/${newest.result})`);
  }

  const result = await collectFarmRun(
    {
      ...cfg.farm,
      runsDir: cfg.paths.runs,
      flakeDb: cfg.paths.flakeDb,
      reportsDir: cfg.paths.reports,
      retention: cfg.retention,
    },
    arn,
    { log: (line) => console.log(`[farm] ${line}`) },
  );

  console.log(`[farm] status=${result.status} result=${result.result}`);
  console.log(`[farm] counters ${JSON.stringify(result.counters)}`);
  // A failed run is a successful pull: the point is to have the evidence, and
  // exiting non-zero here would make a recovery look like a broken tool.
}

main().catch((err: Error) => {
  console.error(`[farm] ${err.message}`);
  process.exit(1);
});
